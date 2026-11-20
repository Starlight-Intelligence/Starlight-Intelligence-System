#!/usr/bin/env python3
"""capintel: receipts, dedupe, conflicts, query and graph for third-party SKILL.md / AGENTS.md.

Canonical output is JSONL receipts. Everything else (SQLite/FTS5, graph, reports) is derived.
Artifact bodies are read only from a pinned clone whose git blob SHA is verified, and are never
written out: receipts keep hashes, bounded frontmatter facts, shingle sketches and flags.
Standard library only. Untrusted text is never executed or interpreted as instructions.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

TOOL_VERSION = "0.1.0"
RECEIPT_SCHEMA = "starlight.capability-receipt.v1"
OUTCOME_SCHEMA = "starlight.capability-outcome.v1"
MAX_BYTES = 256 * 1024
HUGE_BLOB = 64 * 1024 * 1024  # larger artifacts are skipped, never hashed
LICENSE_MAX = 200 * 1024
MAX_LINE = 4000  # longer lines are scanned only up to this and flagged
MAX_FLAGS = 200
SAFE_PATH_RE = re.compile(r"[^\x00-\x1f\x7f]{1,500}")
SKETCH_K = 128
WIDE, NARROW, MIN_SHINGLES = 5, 3, 20  # same shingle policy as claude-skills-library absorb.mjs
DESC_MAX = 240
NEAR_DUP = 0.85  # absorb.mjs distinctness gate
# Values copied from claude-skills-library ABSORPTION.md; detection is implemented here.
ALLOWLIST = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC0-1.0", "CC-BY-4.0", "Unlicense"}
ARTIFACT_NAMES = {"SKILL.md": "skill", "AGENTS.md": "repo_policy"}

SECRET_PATTERNS_NAIVE = [  # exactly the set in starlight-evals scripts/lint-skills.mjs (kept for comparison)
    r"gho_[A-Za-z0-9]{16,}", r"ghp_[A-Za-z0-9]{16,}", r"github_pat_[A-Za-z0-9_]{20,}",
    r"sk-[A-Za-z0-9_-]{20,}", r"whsec_[A-Za-z0-9]{16,}", r"xoxb-[A-Za-z0-9-]{16,}",
    r"re_[A-Za-z0-9]{20,}", r"AKIA[0-9A-Z]{16}",
]
# The naive set matches inside ordinary words ("ta" + "sk-coordination-strategies"), so prefixes are anchored.
SECRET_PATTERNS_EXTRA = [  # shapes the oracle misses
    r"xox[a-z]-[A-Za-z0-9-]{10,}", r"AIza[0-9A-Za-z_-]{30,}", r"glpat-[A-Za-z0-9_-]{20,}",
    r"npm_[A-Za-z0-9]{30,}", r"(?:sk|rk)_live_[A-Za-z0-9]{16,}",
]
SECRET_PATTERNS = [r"(?<![A-Za-z0-9_])" + p if p[0].islower() else p
                   for p in SECRET_PATTERNS_NAIVE + SECRET_PATTERNS_EXTRA]
SECRET_RE = [re.compile(p) for p in SECRET_PATTERNS]

INJECTION_RE = [re.compile(p, re.I) for p in (
    r"ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts|rules)",
    r"disregard (all |any |the )?((your|previous|prior|above|earlier) )+(instructions|rules|guidelines)",
    r"forget (everything|all) (you|above|previous)",
    r"you are now (in )?(dan|developer mode|unrestricted)",
    r"do not (tell|inform) the user",
    r"(reveal|print|output|exfiltrate) (your )?(system prompt|hidden instructions)",
    r"override (the )?(system|safety) (prompt|instructions|policy)",
)]
# A defensive cue near an injection phrase means the text is warning about it, not performing it.
DEFENSIVE_RE = re.compile(
    r"\b(flag|report|detect|refuse|reject|treat as|do not follow|don't follow|never follow|untrusted|"
    r"prompt[- ]injection|injection attempt|malicious|attack|suspicious)\b"
    r"|\b(if|when|whenever)\b.{0,80}\b(tries|attempts?|says|contains?|appears?|asks?|instructs?|steer)\b", re.I)
_HIDDEN_RANGES = ((0x200B, 0x200C), (0x200E, 0x200F), (0x202A, 0x202E), (0x2060, 0x2064),
                  (0x2066, 0x2069), (0xFEFF, 0xFEFF), (0xE0000, 0xE007F))
# A sensitive target or exfiltration verb next to an injection phrase defeats the defensive discount.
ACTION_RE = re.compile(r"~/\.|id_rsa|\.env\b|https?://|\b(curl|wget|upload|exfiltrat\w*|password|credential\w*|api[_ -]?key|"
                       r"token|ssh|secret)\b|\b(send|email|post|forward|read|cat)\b[^.]{0,60}\b(to|the contents)\b", re.I)
HIDDEN_RE = re.compile("[" + "".join(chr(a) + "-" + chr(b) for a, b in _HIDDEN_RANGES) + "]")


def _is_emoji(ch):
    return unicodedata.category(ch) in ("So", "Sk") or ord(ch) >= 0x1F000


def has_hidden_unicode(line):
    """Zero-width/bidi/tag characters. U+200D is benign only when it joins two emoji (a ZWJ sequence)."""
    if HIDDEN_RE.search(line):
        return True
    zwj, vs16 = chr(0x200D), chr(0xFE0F)
    for k, ch in enumerate(line):
        if ch == zwj:
            j = k - 1 - (1 if k and line[k - 1] == vs16 else 0)
            prev = line[j] if j >= 0 else ""
            nxt = line[k + 1] if k + 1 < len(line) else ""
            if not (prev and nxt and _is_emoji(prev) and _is_emoji(nxt)):
                return True
    return False
HTML_COMMENT_RE = re.compile(r"<!--(?:(?!-->).){0,400}?(?:ignore|instruction|system prompt|assistant)(?:(?!-->).){0,400}-->", re.I)
PIPE_SHELL_RE = re.compile(r"(curl|wget)[^\n|]{0,300}\|\s*(sudo\s+)?(ba|z)?sh\b|base64\s+-d[^\n|]{0,300}\|\s*(ba)?sh\b", re.I)
DANGEROUS_RE = re.compile(r"--dangerously-skip-permissions|rm -rf /(?![\w.])|chmod 777")


# ---------- text safety ----------

def clean(s, limit=DESC_MAX):
    """Collapse whitespace, drop control/format/private/unassigned characters (bidi, zero-width, tags),
    and redact secret-shaped tokens so a receipt can never carry one."""
    s = re.sub(r"\s+", " ", s or "").strip()
    s = "".join(c for c in s if unicodedata.category(c) not in ("Cc", "Cf", "Co", "Cn"))
    for rx in SECRET_RE:
        s = rx.sub("[redacted-secret]", s)
    out, n = [], 0
    for ch in s:  # the foundry validator counts UTF-16 code units, not code points
        w = 2 if ord(ch) > 0xFFFF else 1
        if n + w > limit:
            break
        out.append(ch)
        n += w
    return "".join(out)


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def git_blob_sha(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def dumps(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


# ---------- git ----------

def git(clone, *args):
    r = subprocess.run(["git", "-C", str(clone), *args], capture_output=True, check=False)
    if r.returncode:
        raise RuntimeError(f"git {' '.join(args)} failed in {clone}: {r.stderr.decode(errors='replace')[:200]}")
    return r.stdout


def blob_size(clone, blob_sha):
    if not re.fullmatch(r"[0-9a-f]{40}", blob_sha or ""):
        raise RuntimeError("invalid blob sha")
    return int(git(clone, "cat-file", "-s", blob_sha).decode().strip())


def stream_sha256(clone, blob_sha):
    """SHA-256 of a blob without holding it in memory."""
    if not re.fullmatch(r"[0-9a-f]{40}", blob_sha or ""):
        raise RuntimeError("invalid blob sha")
    h = hashlib.sha256()
    with subprocess.Popen(["git", "-C", str(clone), "cat-file", "blob", blob_sha], stdout=subprocess.PIPE) as proc:
        for chunk in iter(lambda: proc.stdout.read(1 << 20), b""):
            h.update(chunk)
    if proc.returncode:
        raise RuntimeError(f"git cat-file failed for {blob_sha}")
    return h.hexdigest()


class SkipArtifact(Exception):
    """One artifact cannot be indexed safely; the run continues and records why."""


def tree_entries(clone, commit, skipped=None):
    """{path: (mode, blob_sha)} for the pinned commit. Fails closed if HEAD is not the pinned commit.
    Paths that are not valid UTF-8 or contain control characters are left out and recorded in `skipped`."""
    head = git(clone, "rev-parse", "HEAD").decode().strip()
    if head != commit:
        raise RuntimeError(f"{clone}: HEAD {head} != pinned {commit}")
    out = git(clone, "ls-tree", "-r", "-z", "HEAD")
    entries = {}
    for rec in out.split(b"\0"):
        if not rec:
            continue
        meta, path = rec.split(b"\t", 1)
        mode, typ, sha = meta.decode().split()
        if typ != "blob":
            continue
        try:
            text = path.decode("utf-8")
        except UnicodeDecodeError:
            text = None
        if text is None or not SAFE_PATH_RE.fullmatch(text) or ".." in text.split("/"):
            if skipped is not None and path.rsplit(b"/", 1)[-1] in (b"SKILL.md", b"AGENTS.md"):
                skipped.append({"reason": "unsafe_path", "path_sha256": sha256(path)})
            continue
        entries[text] = (mode, sha)
    return entries


def read_verified(clone, path, blob_sha):
    """Read the pinned blob from git's object store, never the working tree, so checkout drift (CRLF
    conversion, local edits, symlinks) cannot change what is indexed. The content hash is re-checked."""
    if not re.fullmatch(r"[0-9a-f]{40}", blob_sha or ""):
        raise RuntimeError(f"invalid blob sha for {path}")
    data = git(clone, "cat-file", "blob", blob_sha)
    if git_blob_sha(data) != blob_sha:
        raise RuntimeError(f"blob mismatch for {path}")
    return data


def read_text(path):
    return Path(path).read_text(encoding="utf-8")


def write_text(path, s):
    """UTF-8 with LF endings on every platform, so derived files are byte-identical everywhere."""
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)


# ---------- frontmatter ----------

def parse_frontmatter(text):
    """Minimal key/value reader. Never constructs objects: no anchors, aliases, tags or merges."""
    if not text.startswith("---"):
        return {}, text, "absent"
    m = re.match(r"---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(\r?\n|$)", text, re.S)
    if not m:
        return {}, text, "unterminated"
    fm, key = {}, None
    for line in m.group(1).splitlines():
        kv = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if kv:
            key = kv.group(1)
            fm[key] = kv.group(2).strip()
        elif key and (line.startswith((" ", "\t", "-"))):
            fm[key] = (fm[key] + " " + line.strip()).strip()
    for k, v in list(fm.items()):
        if v in ("|", ">", "|-", ">-"):
            fm[k] = ""
        fm[k] = fm[k].strip("\"'")
    return fm, text[m.end():], "ok"


def split_tools(raw):
    return sorted({t for t in re.split(r"[\s,\[\]]+", raw or "") if t and t != "-"})


def tags_of(fm):
    raw = fm.get("tags", "") or ""
    mt = re.search(r'"tags"\s*:\s*\[([^\]]*)\]', fm.get("metadata", "") or "")
    raw = raw or (mt.group(1) if mt else "")
    return sorted({clean(t.strip("\"' "), 40).lower() for t in re.split(r"[,\[\]]", raw) if t.strip("\"' ")})[:12]


# ---------- sketches ----------

def words_of(body):
    return re.findall(r"[a-z0-9]+", body.lower())


def shingle_hashes(words, w):
    return {int.from_bytes(hashlib.blake2b(" ".join(words[i:i + w]).encode(), digest_size=6).digest(), "big")
            for i in range(max(0, len(words) - w + 1))}


def make_sketch(words):
    for w in (WIDE, NARROW):
        hs = shingle_hashes(words, w)
        if len(hs) >= MIN_SHINGLES:
            return {"w": w, "n": len(hs), "k": sorted(hs)[:SKETCH_K]}
    return {"w": 0, "n": len(shingle_hashes(words, NARROW)), "k": []}


def sketch_jaccard(a, b):
    """Bottom-k estimate. None when either artifact is too short to compare or widths differ."""
    if not a["k"] or not b["k"] or a["w"] != b["w"]:
        return None
    sa, sb = set(a["k"]), set(b["k"])
    union = sorted(sa | sb)[:SKETCH_K]
    return sum(1 for h in union if h in sa and h in sb) / len(union)


def exact_jaccard(words_a, words_b, w):
    a, b = shingle_hashes(words_a, w), shingle_hashes(words_b, w)
    return len(a & b) / len(a | b) if a and b else 0.0


# ---------- licenses ----------

LICENSE_FILE_RE = re.compile(r"^(license|licence|copying|unlicense)(\.(txt|md|rst))?$", re.I)


def detect_spdx(text):
    t = re.sub(r"\s+", " ", text.lower())
    if "gnu affero general public license" in t:
        return "AGPL-3.0"
    if "gnu lesser general public license" in t:
        return "LGPL"
    if "gnu general public license" in t:
        return "GPL"
    for marker, spdx in (("business source license", "BUSL-1.1"), ("commons clause", "Commons-Clause"),
                         ("elastic license", "Elastic-2.0"), ("server side public license", "SSPL-1.0"),
                         ("polyform", "PolyForm"), ("not be used for commercial", "Restricted"),
                         ("no commercial use", "Restricted"), ("source available", "Restricted")):
        if marker in t:
            return spdx
    if "creativecommons.org/publicdomain/zero" in t or "cc0 1.0" in t:
        return "CC0-1.0"
    if "noncommercial" in t or "non-commercial" in t:
        return "CC-BY-NC"
    if "creative commons attribution 4.0" in t:
        return "CC-BY-4.0"
    if "apache license" in t and "version 2.0" in t:
        return "Apache-2.0"
    if "free and unencumbered software released into the public domain" in t:
        return "Unlicense"
    if "permission is hereby granted, free of charge" in t:
        return "MIT"
    if "permission to use, copy, modify, and/or distribute this software" in t:
        return "ISC"
    if "redistribution and use in source and binary forms" in t:
        return "BSD-3-Clause" if "neither the name" in t else "BSD-2-Clause"
    if "all rights reserved" in t or "proprietary" in t:
        return "Proprietary"
    return "unrecognized"


NONFREE_MARK_RE = re.compile(r"gpl|proprietary|commercial|non-?commercial|all rights reserved|business source|sspl|"
                             r"elastic|polyform|cc-by-nc|unlicensed", re.I)
ALLOW_CANON = {x.lower(): x for x in ALLOWLIST}


def status_of(resolved):
    parts = [p for p in re.split(r" (?:OR|AND) ", resolved)]
    if all(p in ALLOWLIST for p in parts):
        return "allowlisted"
    return "unknown" if resolved in ("unknown", "unrecognized") else "refused"


def frontmatter_spdx(raw):
    """Accept only a pure expression of allowlisted ids joined by OR/AND (deterministic order); else None."""
    s = (raw or "").strip().strip("()")
    if not s:
        return None
    toks = [x for x in re.split(r"\s+(OR|AND)\s+", s, flags=re.I)]
    ids = toks[0::2]
    ops = {o.upper() for o in toks[1::2]}
    if not all(i.strip().lower() in ALLOW_CANON for i in ids) or len(ops) > 1:
        return None
    canon = sorted({ALLOW_CANON[i.strip().lower()] for i in ids})
    return (" %s " % (ops.pop() if ops else "OR")).join(canon)


_LICENSE_CACHE = {}


def license_index(tree):
    """{directory: (path, blob_sha)} of regular-file license candidates; first by name wins."""
    idx = {}
    for p, (mode, sha) in sorted(tree.items()):
        d, _, base = p.rpartition("/")
        if LICENSE_FILE_RE.match(base) and mode in ("100644", "100755"):
            idx.setdefault(d, (p, sha))
    return idx


def resolve_license(path, fm_license, lic_index, clone):
    """Nearest license file wins; then frontmatter; anything else is unknown. Evidence is the blob SHA."""
    parts = path.split("/")[:-1]
    found = None
    for depth in range(len(parts), -1, -1):
        hit = lic_index.get("/".join(parts[:depth]))
        if hit:
            found = (hit[0], hit[1], "artifact_adjacent" if depth else "repo_root")
            break
    file_spdx, evidence = None, None
    if found:
        key = (str(clone), found[1])
        if key not in _LICENSE_CACHE:
            if blob_size(clone, found[1]) > LICENSE_MAX:
                _LICENSE_CACHE[key] = "unrecognized"  # too large to read in full, so never trusted
            else:
                _LICENSE_CACHE[key] = detect_spdx(read_verified(clone, found[0], found[1]).decode("utf-8", "replace"))
        file_spdx = _LICENSE_CACHE[key]
        evidence = {"file": found[0], "blob_sha": found[1], "scope": found[2], "detected": file_spdx}
    fm_spdx = frontmatter_spdx(fm_license)
    if found and file_spdx in (None, "unrecognized"):
        resolved, source = "unrecognized", "license_file_unrecognized"  # frontmatter cannot upgrade a license file
    elif file_spdx and file_spdx != "unrecognized":
        resolved, source = file_spdx, "license_file"
        if (fm_spdx and fm_spdx != file_spdx) or (not fm_spdx and NONFREE_MARK_RE.search(fm_license or "")
                                                   and file_spdx in ALLOWLIST):
            resolved, source = "conflict", "license_file_vs_frontmatter"
    elif fm_spdx:
        resolved, source = fm_spdx, "frontmatter"
    else:
        resolved, source = "unknown", "none"
    status = status_of(resolved)
    return {"resolved": resolved, "status": status, "source": source,
            "frontmatter": clean(fm_license, 80), "evidence": evidence}


# ---------- security flags ----------

def injection_flags(text):
    """Injection phrases on whitespace-collapsed, invisible-character-stripped text, so phrases split across
    lines or padded with zero-width characters are still found. A defensive cue discounts a hit to 'info'
    unless a sensitive target or exfiltration verb sits next to it."""
    out, offs, pieces, pos = [], [], [], 0
    for n, ln in enumerate(text.splitlines(), 1):
        seg = "".join(ch for ch in ln if unicodedata.category(ch) != "Cf")
        offs.append((pos, n))
        pieces.append(seg)
        pos += len(seg) + 1
    flat = " ".join(pieces)
    for rx in INJECTION_RE:
        for m in rx.finditer(flat):
            near = flat[max(0, m.start() - 160):m.end() + 160]
            line = max(n for o, n in offs if o <= m.start())
            sev = "high" if ACTION_RE.search(near) or not DEFENSIVE_RE.search(near) else "info"
            out.append({"rule": "injection_phrase", "line": line, "severity": sev})
    return [dict(t) for t in {tuple(sorted(f.items())) for f in out}]


def scan(text, fm, tree_paths, path):
    flags = []
    lines = text.splitlines()
    in_fence = False
    for i, ln in enumerate(lines, 1):
        if len(ln) > MAX_LINE:
            ln = ln[:MAX_LINE]
            flags.append({"rule": "long_line", "line": i, "severity": "review"})
        if re.match(r"^\s*```", ln):
            in_fence = not in_fence
            continue
        if not in_fence and "lint-allow:" not in ln and re.search(r"\$\d", ln):
            flags.append({"rule": "dollar-digit", "line": i, "severity": "error"})
        for rx in SECRET_RE:
            if rx.search(ln):
                flags.append({"rule": "secret", "line": i, "severity": "high"})
        if has_hidden_unicode(ln) and not (i == 1 and ln.startswith(chr(0xFEFF))):
            flags.append({"rule": "hidden_unicode", "line": i, "severity": "high"})
        if HTML_COMMENT_RE.search(ln):
            flags.append({"rule": "hidden_comment", "line": i, "severity": "review"})
        if PIPE_SHELL_RE.search(ln):
            flags.append({"rule": "pipe_to_shell", "line": i, "severity": "review"})
        if DANGEROUS_RE.search(ln):
            flags.append({"rule": "dangerous_flag", "line": i, "severity": "review"})
    flags.extend(injection_flags(text))
    tools = split_tools(fm.get("allowed-tools", ""))
    if any(t == "*" or t == "Bash" or t.startswith("Bash(*") for t in tools):
        flags.append({"rule": "broad_tool_grant", "line": 1, "severity": "review"})
    adir = path.rsplit("/", 1)[0] + "/" if "/" in path else ""
    if any(p.startswith(adir + "scripts/") for p in tree_paths):
        flags.append({"rule": "bundled_scripts", "line": 0, "severity": "review"})
    return flags


def naive_injection(text):
    """Baseline used before this tool: any phrase hit counts, context ignored."""
    return any(rx.search(ln) for ln in text.splitlines() for rx in INJECTION_RE)


def improved_injection(text):
    return any(f["severity"] == "high" for f in injection_flags(text))


# ---------- directives (conflict candidates) ----------

NEG_RE = re.compile(r"\b(never|do not|don't|must not|mustn't|should not|shouldn't|avoid|cannot|can't)\b", re.I)
POS_RE = re.compile(r"\b(always|must|should|shall|ensure|make sure to)\b", re.I)
STOP = set("a an the to of and or in on for with is are be it this that these those you your we our as at by from "
           "any all when if then do not dont never always must should shall avoid ensure make sure use using can will would".split())


def stem(w):
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > 4 and w.endswith(suf):
            return w[:-len(suf)]
    return w


def directives(body):
    out, fence = [], False
    for i, ln in enumerate(body.splitlines(), 1):
        if re.match(r"^\s*```", ln):
            fence = not fence
            continue
        if fence:
            continue
        for pol, rx in (("neg", NEG_RE), ("pos", POS_RE)):
            m = rx.search(ln)
            if m:
                toks = sorted({stem(w) for w in re.findall(r"[a-z]+", ln[m.end():].lower()) if w not in STOP})[:12]
                if len(toks) >= 3:
                    out.append({"line": i, "pol": pol, "toks": toks})
                break
    return out


def find_conflicts(dir_by_artifact, min_sim=0.6):
    index = defaultdict(list)
    flat = []
    for aid in sorted(dir_by_artifact):
        for d in dir_by_artifact[aid]:
            flat.append((aid, d))
            for t in d["toks"]:
                index[t].append(len(flat) - 1)
    seen, out = set(), []
    for n, (aid, d) in enumerate(flat):
        counts = Counter(j for t in d["toks"] for j in index[t] if j > n)
        for j, c in counts.items():
            bid, e = flat[j]
            if bid == aid or e["pol"] == d["pol"] or c < 2:
                continue
            sa, sb = set(d["toks"]), set(e["toks"])
            sim = len(sa & sb) / len(sa | sb)
            if sim >= min_sim and (aid, d["line"], bid, e["line"]) not in seen:
                seen.add((aid, d["line"], bid, e["line"]))
                a_first = (aid, d["line"]) <= (bid, e["line"])
                x, y = ((aid, d), (bid, e)) if a_first else ((bid, e), (aid, d))
                out.append({"a": x[0], "a_line": x[1]["line"], "a_pol": x[1]["pol"],
                            "b": y[0], "b_line": y[1]["line"], "b_pol": y[1]["pol"],
                            "similarity": round(sim, 3), "shared": sorted(sa & sb)})
    return sorted(out, key=lambda r: (-r["similarity"], r["a"], r["a_line"], r["b"], r["b_line"]))


# ---------- ingest ----------

def make_receipt(src, clone, path, mode_sha, tree, lic_index, observed_at):
    mode, blob = mode_sha
    base = path.rsplit("/", 1)[-1]
    rec = {"schema": RECEIPT_SCHEMA, "artifact_id": f"{src['slug']}@{src['commit'][:12]}:{path}",
           "estate": src["role"], "kind": ARTIFACT_NAMES[base], "observed_at": observed_at,
           "tool_version": TOOL_VERSION,
           "source": {"repository": src["url"], "commit": src["commit"], "path": path, "blob_sha": blob}}
    size = blob_size(clone, blob)
    if size > HUGE_BLOB:
        raise SkipArtifact("too_large_unhashable")
    if size > MAX_BYTES:
        rec["content"] = {"bytes": size, "sha256": stream_sha256(clone, blob)}
        rec.update(skipped="too_large", frontmatter={}, license={"resolved": "unknown", "status": "unknown"},
                   flags=[], security_verdict="unscanned")
        return rec, None, None
    data = read_verified(clone, path, blob)
    rec["content"] = {"bytes": len(data), "sha256": sha256(data)}
    text = data.decode("utf-8", "replace")
    fm, body, status = parse_frontmatter(text)
    words = words_of(body)
    folder = path.rsplit("/", 2)[-2] if path.count("/") else ""
    name = clean(fm.get("name", ""), 80)
    desc_raw = fm.get("description", "")
    rec["frontmatter"] = {
        "parse": status, "name": name, "description": clean(desc_raw), "description_chars": len(desc_raw),
        "allowed_tools": [x for x in (clean(tool, 80) for tool in split_tools(fm.get("allowed-tools", ""))[:20]) if x],
        "tags": tags_of(fm),
        "name_matches_folder": bool(name) and name == folder,
    }
    rec["content"]["normalized_sha256"] = sha256(" ".join(words).encode())
    rec["content"]["words"] = len(words)
    rec["license"] = resolve_license(path, fm.get("license", ""), lic_index, clone)
    flags = scan(text, fm, tree.keys(), path)
    flags += injection_flags(desc_raw + " " + fm.get("name", ""))
    if rec["kind"] == "skill":
        if not name:
            flags.append({"rule": "frontmatter", "line": 1, "severity": "error"})
        elif name != folder:
            flags.append({"rule": "frontmatter", "line": 1, "severity": "error"})
        if not desc_raw or len(desc_raw) > 1024:
            flags.append({"rule": "frontmatter", "line": 1, "severity": "error"})
    if len(flags) > MAX_FLAGS:  # keep the most severe, say so, never grow without bound
        rank = {"high": 0, "review": 1, "info": 2, "error": 3}
        flags = sorted(flags, key=lambda f: (rank[f["severity"]], f["line"], f["rule"]))[:MAX_FLAGS]
        flags.append({"rule": "flags_truncated", "line": 0, "severity": "review"})
    rec["flags"] = sorted(flags, key=lambda f: (f["line"], f["rule"]))
    rec["security_verdict"] = ("blocked" if any(f["severity"] == "high" for f in flags)
                               else "review" if any(f["severity"] in ("review", "info") for f in flags) else "clean")
    blob_json = json.dumps(rec, ensure_ascii=False)  # not ASCII-escaped, so lookbehinds see real neighbors
    if any(rx.search(blob_json) for rx in SECRET_RE):  # a receipt must never carry a secret
        raise SkipArtifact("secret_shaped_text")
    return rec, {"artifact_id": rec["artifact_id"], **make_sketch(words)}, directives(body)


def select_sample(candidates, n, seed):
    """Deterministic round-robin over repos ordered by seeded hash; no repo dominates."""
    by_repo = defaultdict(list)
    for slug, path in candidates:
        by_repo[slug].append(path)
    rank = lambda s: hashlib.sha256((seed + s).encode()).hexdigest()
    for slug in by_repo:
        by_repo[slug].sort(key=lambda p: rank(slug + "/" + p))
    order, picked = sorted(by_repo, key=rank), []
    while len(picked) < n and any(by_repo.values()):
        for slug in order:
            if by_repo[slug] and len(picked) < n:
                picked.append((slug, by_repo[slug].pop(0)))
    return set(picked)


def cmd_ingest(a):
    cfg = json.loads(read_text(a.sources))
    srcs, trees, cands = cfg["sources"], {}, []
    lic_idx, skipped = {}, []
    for s in srcs:
        clone = Path(a.clones) / s["slug"]
        actual = datetime.fromisoformat(git(clone, "show", "-s", "--format=%cI", s["commit"]).decode().strip())
        if actual != datetime.fromisoformat(s["commit_date"].replace("Z", "+00:00")):
            raise RuntimeError(f"{s['slug']}: commit_date {s['commit_date']} != clone {actual.isoformat()}")
        trees[s["slug"]] = tree_entries(clone, s["commit"], skipped)
        lic_idx[s["slug"]] = license_index(trees[s["slug"]])
        prefix = (s.get("scope", "") + "/") if s.get("scope") else ""
        for p, (mode, _) in trees[s["slug"]].items():
            if p.rsplit("/", 1)[-1] in ARTIFACT_NAMES and mode in ("100644", "100755") and p.startswith(prefix):
                cands.append((s["slug"], p, s["role"]))
    ext = [(s, p) for s, p, r in cands if r == "external"]
    chosen = {(s, p) for s, p in ext} if a.all else select_sample(ext, a.sample, a.seed)
    chosen |= {(s, p) for s, p, r in cands if r == "baseline"}
    receipts, sketches, dirs = [], [], {}
    src_by_slug = {s["slug"]: s for s in srcs}
    for slug, path in sorted(chosen):
        s = src_by_slug[slug]
        tree = trees[slug]
        try:
            rec, sk, dv = make_receipt(s, Path(a.clones) / slug, path, tree[path], tree, lic_idx[slug], a.observed_at)
        except SkipArtifact as why:
            skipped.append({"reason": str(why), "path_sha256": sha256(path.encode("utf-8"))})
            continue
        receipts.append(rec)
        if sk:
            sketches.append(sk)
            dirs[rec["artifact_id"]] = dv
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    write_jsonl(out / "receipts.jsonl", sorted(receipts, key=lambda r: r["artifact_id"]))
    write_jsonl(out / "sketches.jsonl", sorted(sketches, key=lambda r: r["artifact_id"]))
    write_jsonl(out / "conflicts.jsonl", find_conflicts(dirs))
    write_jsonl(out / "skipped.jsonl", sorted(skipped, key=lambda r: (r["reason"], r["path_sha256"])))
    ne = sum(1 for r in receipts if r["estate"] == "external")
    print(f"receipts={len(receipts)} external={ne} baseline={len(receipts) - ne} skipped={len(skipped)} out={out}")


def write_jsonl(path, rows):
    write_text(path, "".join(dumps(r) + "\n" for r in rows))


def read_jsonl(path):
    p = Path(path)
    return [json.loads(l) for l in read_text(p).splitlines() if l.strip()] if p.exists() else []


# ---------- duplicates ----------

def dupe_clusters(receipts, sketches, threshold=NEAR_DUP):
    """Union-find over exact normalized-hash matches and sketch Jaccard >= threshold (skills only)."""
    skills = [r for r in receipts if r["kind"] == "skill" and "normalized_sha256" in r.get("content", {})]
    sk = {s["artifact_id"]: s for s in sketches}
    parent = {r["artifact_id"]: r["artifact_id"] for r in skills}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    by_hash = defaultdict(list)
    for r in skills:
        c_ = r["content"]
        key = c_["normalized_sha256"] if c_.get("words", 0) >= MIN_SHINGLES else "raw:" + c_["sha256"]
        by_hash[key].append(r["artifact_id"])
    pairs = []
    for ids in by_hash.values():
        for other in ids[1:]:
            parent[find(other)] = find(ids[0])
            pairs.append((ids[0], other, 1.0, "exact"))
    ids = sorted(parent)
    inv = defaultdict(list)
    for x in ids:
        for h in sk.get(x, {}).get("k", []):
            inv[h].append(x)
    for x in ids:
        shared = Counter(y for h in sk.get(x, {}).get("k", []) for y in inv[h] if y > x)
        for y, c in sorted(shared.items()):
            if c < 3:  # >=0.85 similarity implies far more than 3 shared bottom-k hashes
                continue
            j = sketch_jaccard(sk[x], sk[y])
            if j is not None and j >= threshold:
                parent[find(y)] = find(x)
                pairs.append((x, y, round(j, 3), "near"))
    groups = defaultdict(list)
    for x in ids:
        groups[find(x)].append(x)
    return [sorted(g) for g in groups.values() if len(g) > 1], pairs


# ---------- SQLite / FTS5 ----------

SCHEMA = """
CREATE TABLE artifacts(id TEXT PRIMARY KEY, estate TEXT, repo TEXT, commit_sha TEXT, path TEXT, blob_sha TEXT,
  kind TEXT, name TEXT, description TEXT, tags TEXT, license TEXT, license_status TEXT, verdict TEXT,
  high_flags INTEGER, review_flags INTEGER, observed_at TEXT, cluster TEXT, outcome TEXT);
CREATE VIRTUAL TABLE artifacts_fts USING fts5(name, description, tags, repo, path, content='artifacts', content_rowid='rowid');
"""


def build_db(data_dir, db_path):
    receipts = read_jsonl(Path(data_dir) / "receipts.jsonl")
    sketches = read_jsonl(Path(data_dir) / "sketches.jsonl")
    outcomes = read_jsonl(Path(data_dir) / "outcomes.jsonl")
    clusters, _ = dupe_clusters(receipts, sketches)
    cl = {a: g[0] for g in clusters for a in g}
    last = {}
    for o in outcomes:
        last[o["artifact_id"]] = o["status"]
    if Path(db_path).exists():
        Path(db_path).unlink()
    db = sqlite3.connect(db_path)
    db.executescript(SCHEMA)
    for r in receipts:
        fm, lic = r.get("frontmatter", {}), r.get("license", {})
        fl = r.get("flags", [])
        db.execute("INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
            r["artifact_id"], r["estate"], r["source"]["repository"], r["source"]["commit"], r["source"]["path"],
            r["source"]["blob_sha"], r["kind"], fm.get("name", ""), fm.get("description", ""),
            " ".join(fm.get("tags", [])), lic.get("resolved", ""), lic.get("status", ""), r.get("security_verdict", ""),
            sum(f["severity"] == "high" for f in fl), sum(f["severity"] == "review" for f in fl),
            r["observed_at"], cl.get(r["artifact_id"], ""), last.get(r["artifact_id"], "")))
    db.execute("INSERT INTO artifacts_fts(rowid,name,description,tags,repo,path) "
               "SELECT rowid,name,description,tags,repo,path FROM artifacts")
    db.commit()
    dump = sha256("\n".join(db.iterdump()).encode())
    db.close()
    return dump, len(receipts)


def fts_query(text):
    toks = re.findall(r"[A-Za-z0-9]+", text)
    return " ".join('"%s"' % t for t in toks)


def search(db_path, text, limit=10, license_status=None, kind=None, estate=None, no_blocked=False):
    q = fts_query(text)
    if not q:
        return []
    db = sqlite3.connect(db_path)
    sql = ("SELECT a.id,a.name,a.description,a.license,a.license_status,a.verdict,a.kind,a.estate,a.cluster,a.outcome "
           "FROM artifacts_fts f JOIN artifacts a ON a.rowid=f.rowid WHERE artifacts_fts MATCH ?")
    args = [q]
    for col, v in (("a.license_status", license_status), ("a.kind", kind), ("a.estate", estate)):
        if v:
            sql += f" AND {col}=?"
            args.append(v)
    if no_blocked:
        sql += " AND a.verdict!='blocked'"
    sql += " ORDER BY bm25(artifacts_fts), a.id LIMIT ?"
    args.append(limit)
    keys = "id name description license license_status verdict kind estate cluster outcome".split()
    rows = [dict(zip(keys, r)) for r in db.execute(sql, args)]
    db.close()
    return rows


# ---------- capability graph (SIS foundry schema, unmodified) ----------

def slugify(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9-]", "-", s.lower())).strip("-")


def build_graph(data_dir, sources_path):
    receipts = read_jsonl(Path(data_dir) / "receipts.jsonl")
    sketches = read_jsonl(Path(data_dir) / "sketches.jsonl")
    cfg_bytes = Path(sources_path).read_bytes()
    cfg = json.loads(cfg_bytes)
    slugs = {s["url"]: s["slug"] for s in cfg["sources"]}
    _, pairs = dupe_clusters(receipts, sketches)
    ids, used = {}, set()
    for r in sorted(receipts, key=lambda r: r["artifact_id"]):
        if r["kind"] != "skill":
            continue
        slug = slugs[r["source"]["repository"]]
        parts = r["source"]["path"].split("/")
        name = r["frontmatter"].get("name") or (parts[-2] if len(parts) > 1 else "root")
        base = (slugify(slug) + "/" + slugify(name))[:110].strip("-/") or "skill"
        nid, k = "skill:" + base, 1
        while nid in used:
            k += 1
            # keyed on the path, not the content, so an id does not change when a file is edited
            nid = f"skill:{base}-{sha256(r['source']['path'].encode('utf-8'))[:6]}" + ("" if k == 2 else f"-{k}")
        used.add(nid)
        ids[r["artifact_id"]] = nid
    # Foundry semantics: an alias names exactly one canonical node, so duplicates collapse into one node and
    # the other copies become its aliases. Copies merge only when they share a name, a security verdict and a
    # license outcome, so a blocked or unlicensed copy is never hidden behind a clean one. Differently named
    # near-duplicates may be different skills, so they stay separate nodes (see the `dupes` report).
    by_id = {r["artifact_id"]: r for r in receipts}
    name_of = {a: (by_id[a]["frontmatter"].get("name") or "").lower() for a in ids}
    trust_of = {a: (by_id[a]["security_verdict"], by_id[a]["license"]["status"], by_id[a]["license"]["resolved"])
                for a in ids}
    parent = {a: a for a in ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for x, y, _sim, _kind in pairs:
        if x in ids and y in ids and name_of[x] and name_of[x] == name_of[y] and trust_of[x] == trust_of[y]:
            parent[find(y)] = find(x)
    groups = defaultdict(list)
    for a in ids:
        groups[find(a)].append(a)
    nodes = []
    for members in groups.values():
        members.sort(key=lambda a: (by_id[a]["estate"] != "baseline", ids[a]))  # our own copy is canonical
        r = by_id[members[0]]
        n = {"id": ids[members[0]], "kind": "skill", "status": "registered", "path": r["source"]["path"],
             "description": r["frontmatter"].get("description", ""), "provides": r["frontmatter"].get("tags", [])}
        if len(members) > 1:
            n["aliases"] = sorted(ids[m] for m in members[1:])
        nodes.append(n)
    nodes.sort(key=lambda n: n["id"])
    newest = max(datetime.fromisoformat(s["commit_date"].replace("Z", "+00:00")) for s in cfg["sources"])
    return {"schemaVersion": "1.0.0",
            "generatedAt": newest.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": {"skillRules": "foundry/capability-index/sources.json#sha256:" + sha256(cfg_bytes),
                       "agentRegistry": "none"},
            "nodes": nodes, "edges": []}


# ---------- outcomes ----------

def cmd_outcome(a):
    out = Path(a.data_dir)
    known = {r["artifact_id"] for r in read_jsonl(out / "receipts.jsonl")}
    if a.artifact not in known:
        sys.exit(f"unknown artifact {a.artifact}")
    rec = {"schema": OUTCOME_SCHEMA, "artifact_id": a.artifact, "status": a.status, "evidence": clean(a.evidence, 300),
           "writer": clean(a.writer, 60), "note": clean(a.note, 200), "recorded_at": a.recorded_at,
           "verified": False}
    with open(out / "outcomes.jsonl", "a", encoding="utf-8", newline="\n") as f:
        f.write(dumps(rec) + "\n")
    print("recorded (unverified; does not influence ranking)")


# ---------- evaluations ----------

def run_lint(lint_script, clone):
    r = subprocess.run(["node", str(lint_script), str(clone)], capture_output=True, text=True, encoding="utf-8",
                       errors="replace", check=False)
    found = defaultdict(set)
    for ln in r.stdout.splitlines():
        m = re.match(r"^(ERROR|WARNING) (.+?):(\d+) \[([\w-]+)\]", ln)
        if m and m.group(1) == "ERROR":
            found[os.path.relpath(m.group(2), os.path.abspath(clone)).replace(os.sep, "/")].add(m.group(4))
    return found


def cmd_eval(a):
    prereg_path = Path(a.prereg)
    if sha256(prereg_path.read_bytes()) != read_text(a.prereg + ".sha256").split()[0]:
        sys.exit("preregistration hash mismatch: thresholds changed after registration")
    prereg = json.loads(read_text(prereg_path))
    receipts = read_jsonl(Path(a.data_dir) / "receipts.jsonl")
    sketches = {s["artifact_id"]: s for s in read_jsonl(Path(a.data_dir) / "sketches.jsonl")}
    results = {"schema": "starlight.capability-eval.v1", "tool_version": TOOL_VERSION,
               "preregistration_sha256": sha256(prereg_path.read_bytes()), "evals": {}}
    ext = [r for r in receipts if r["estate"] == "external" and r["kind"] == "skill" and "frontmatter" in r
           and r["frontmatter"]]
    base = [r for r in receipts if r["estate"] == "baseline" and r["kind"] == "skill" and r["frontmatter"]]
    # E1: conformance + hygiene, cross-checked against the existing starlight-evals linter.
    conf = lambda rs: sum(1 for r in rs if not any(f["rule"] == "frontmatter" for f in r["flags"])) / max(1, len(rs))
    e1 = {"external_conformance_rate": round(conf(ext), 3), "baseline_conformance_rate": round(conf(base), 3),
          "external_blocked": sum(r["security_verdict"] == "blocked" for r in ext), "n_external": len(ext)}
    if a.lint and a.clones:
        shared = {"frontmatter", "dollar-digit", "secret"}
        agree = total = positives = 0
        diffs = []
        src = {s["url"]: s for s in json.loads(read_text(a.sources))["sources"]}
        by_repo = defaultdict(list)
        for r in ext:
            by_repo[r["source"]["repository"]].append(r)
        for url, rs in sorted(by_repo.items()):
            lint = run_lint(a.lint, Path(a.clones) / src[url]["slug"])
            for r in rs:
                ours = {f["rule"] for f in r["flags"] if f["rule"] in shared and f["severity"] in ("error", "high")}
                theirs = lint.get(r["source"]["path"], set()) & shared
                for rule in shared:
                    total += 1
                    positives += (rule in ours) or (rule in theirs)
                    if (rule in ours) == (rule in theirs):
                        agree += 1
                    else:
                        diffs.append({"artifact": r["artifact_id"], "rule": rule, "ours": rule in ours,
                                      "lint": rule in theirs})
        pos = [d for d in diffs]  # disagreements all involve a positive on one side
        e1.update(lint_agreement=round(agree / total, 4) if total else None, lint_pairs=total,
                  positive_pairs_ours_or_lint=positives, positive_agreement=round((positives - len(diffs)) / positives, 4) if positives else None,
                  disagreements=diffs[:40], disagreement_count=len(diffs))
        thr = prereg["e1"]["min_lint_agreement"]
        e1["pass"] = bool(total) and agree / total >= thr
    else:
        e1["pass"] = None
        e1["skipped"] = "lint oracle or clones not provided"
    results["evals"]["e1_conformance_vs_existing_linter"] = e1
    # E2: distinctness against our estate, vs the existing name-collision baseline.
    names = {r["frontmatter"]["name"] for r in base if r["frontmatter"].get("name")}
    rows, name_hits, missed = [], 0, []
    for r in ext:
        sk = sketches.get(r["artifact_id"])
        best = (0.0, None)
        for b in base:
            sb = sketches.get(b["artifact_id"])
            j = sketch_jaccard(sk, sb) if sk and sb else None
            if j is not None and j > best[0]:
                best = (j, b["artifact_id"])
        by_name = r["frontmatter"].get("name") in names
        name_hits += by_name
        if best[0] >= prereg["e2"]["overlap_threshold"] and not by_name:
            missed.append({"artifact": r["artifact_id"], "nearest": best[1], "similarity": round(best[0], 3)})
        rows.append(best[0])
    e2 = {"n_external": len(ext), "n_baseline": len(base),
          "overlap_threshold": prereg["e2"]["overlap_threshold"],
          "overlapping_with_estate": sum(1 for j in rows if j >= prereg["e2"]["overlap_threshold"]),
          "caught_by_name_collision": name_hits, "missed_by_name_collision": len(missed),
          "missed_examples": missed[:10]}
    e2["pass"] = None
    if a.clones:
        e2.update(estimator_check(receipts, sketches, a.clones, a.sources, prereg["e2"]))
    results["evals"]["e2_distinctness_vs_estate"] = e2
    # E3: injection scanner on labeled fixtures.
    cases = json.loads(read_text(a.fixtures))["cases"]
    t = lambda fn, lab: [fn(c["text"]) for c in cases if c["label"] == lab]
    attacks_n, attacks_i = t(naive_injection, "attack"), t(improved_injection, "attack")
    clean_n = t(naive_injection, "defensive") + t(naive_injection, "benign")
    clean_i = t(improved_injection, "defensive") + t(improved_injection, "benign")
    e3 = {"n_attack": len(attacks_n), "n_non_attack": len(clean_n),
          "baseline": {"recall": round(sum(attacks_n) / len(attacks_n), 3), "false_positive_rate": round(sum(clean_n) / len(clean_n), 3)},
          "improved": {"recall": round(sum(attacks_i) / len(attacks_i), 3), "false_positive_rate": round(sum(clean_i) / len(clean_i), 3)}}
    th = prereg["e3"]
    e3["pass"] = (e3["improved"]["recall"] >= th["min_recall"] and
                  e3["improved"]["false_positive_rate"] <= th["max_false_positive_rate"] and
                  e3["improved"]["false_positive_rate"] < e3["baseline"]["false_positive_rate"])
    results["evals"]["e3_injection_scanner_vs_naive"] = e3
    write_text(a.out, json.dumps(results, indent=1, sort_keys=True) + "\n")
    for k, v in results["evals"].items():
        print(k, "pass=", v["pass"])


def estimator_check(receipts, sketches, clones, sources, cfg):
    """Compare the sketch estimate with exact Jaccard (needs pinned clones) on a deterministic pair sample."""
    src = {s["url"]: s for s in json.loads(read_text(sources))["sources"]}
    skill = [r for r in receipts if r["kind"] == "skill" and sketches.get(r["artifact_id"], {}).get("k")]
    skill.sort(key=lambda r: sha256(r["artifact_id"].encode()))
    errs = []
    cache = {}

    def words(r):
        if r["artifact_id"] not in cache:
            s = src[r["source"]["repository"]]
            raw = read_verified(Path(clones) / s["slug"], r["source"]["path"], r["source"]["blob_sha"])
            cache[r["artifact_id"]] = words_of(parse_frontmatter(raw.decode("utf-8", "replace"))[1])
        return cache[r["artifact_id"]]
    for i in range(0, min(len(skill) - 1, cfg["pairs"] * 2), 2):
        a, b = skill[i], skill[i + 1]
        sa, sb = sketches[a["artifact_id"]], sketches[b["artifact_id"]]
        est = sketch_jaccard(sa, sb)
        if est is not None:
            errs.append(abs(est - exact_jaccard(words(a), words(b), sa["w"])))
    # Random pairs are almost all ~0 similarity; also check near pairs found by the sketch itself.
    for r in skill[:cfg["pairs"]]:
        best = max(((sketch_jaccard(sketches[r["artifact_id"]], sketches[o["artifact_id"]]) or 0, o)
                    for o in skill if o is not r), key=lambda x: x[0], default=(0, None))
        if best[1] is not None and best[0] > 0.2:
            sa = sketches[r["artifact_id"]]
            errs.append(abs(best[0] - exact_jaccard(words(r), words(best[1]), sa["w"])))
    ok = sum(1 for e in errs if e <= cfg["max_abs_error"]) / len(errs) if errs else None
    return {"estimator_pairs": len(errs), "estimator_within_tolerance": None if ok is None else round(ok, 3),
            "estimator_max_error": round(max(errs), 3) if errs else None,
            "pass": ok is not None and ok >= cfg["min_within_tolerance"]}


# ---------- CLI ----------

def main(argv=None):
    ap = argparse.ArgumentParser(prog="capintel", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("ingest")
    p.add_argument("--sources", default="sources.json")
    p.add_argument("--clones", required=True)
    p.add_argument("--out-dir", default="data")
    p.add_argument("--observed-at", required=True)
    p.add_argument("--sample", type=int, default=100)
    p.add_argument("--seed", default="capability-intel-v1")
    p.add_argument("--all", action="store_true")
    p = sub.add_parser("build-db")
    p.add_argument("--data-dir", default="data")
    p.add_argument("--db", default="data/index.sqlite")
    p = sub.add_parser("query")
    p.add_argument("text")
    p.add_argument("--db", default="data/index.sqlite")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--license-status")
    p.add_argument("--kind")
    p.add_argument("--estate")
    p.add_argument("--no-blocked", action="store_true")
    p = sub.add_parser("dupes")
    p.add_argument("--data-dir", default="data")
    p = sub.add_parser("graph")
    p.add_argument("--data-dir", default="data")
    p.add_argument("--sources", default="sources.json")
    p.add_argument("--out", default="data/capability-graph.json")
    p = sub.add_parser("outcome")
    p.add_argument("--data-dir", default="data")
    p.add_argument("--artifact", required=True)
    p.add_argument("--status", required=True, choices=["accepted", "rejected", "failed", "adopted"])
    p.add_argument("--evidence", required=True)
    p.add_argument("--writer", required=True)
    p.add_argument("--note", default="")
    p.add_argument("--recorded-at", required=True)
    p = sub.add_parser("eval")
    p.add_argument("--data-dir", default="data")
    p.add_argument("--sources", default="sources.json")
    p.add_argument("--clones")
    p.add_argument("--lint")
    p.add_argument("--prereg", default="evals/prereg.json")
    p.add_argument("--fixtures", default="evals/injection_cases.json")
    p.add_argument("--out", default="evals/results.json")
    a = ap.parse_args(argv)
    if a.cmd == "ingest":
        cmd_ingest(a)
    elif a.cmd == "build-db":
        dump, n = build_db(a.data_dir, a.db)
        print(f"artifacts={n} dump_sha256={dump}")
    elif a.cmd == "query":
        for r in search(a.db, a.text, a.limit, a.license_status, a.kind, a.estate, a.no_blocked):
            # Third-party text is printed as a JSON string literal: quoted data, never raw.
            q = json.dumps
            print(f"{q(r['id'])}\n  name={q(r['name'])} license={q(r['license'])}({q(r['license_status'])}) "
                  f"verdict={q(r['verdict'])} kind={q(r['kind'])} estate={q(r['estate'])}"
                  f"{' cluster=' + q(r['cluster']) if r['cluster'] else ''}"
                  f"{' outcome=' + q(r['outcome']) if r['outcome'] else ''}\n  description={q(r['description'])}")
    elif a.cmd == "dupes":
        rec = read_jsonl(Path(a.data_dir) / "receipts.jsonl")
        groups, pairs = dupe_clusters(rec, read_jsonl(Path(a.data_dir) / "sketches.jsonl"))
        print(json.dumps({"clusters": groups, "pairs": pairs}, indent=1))
    elif a.cmd == "graph":
        write_text(a.out, json.dumps(build_graph(a.data_dir, a.sources), indent=1, sort_keys=True) + "\n")
        print("wrote", a.out)
    elif a.cmd == "outcome":
        cmd_outcome(a)
    elif a.cmd == "eval":
        cmd_eval(a)


if __name__ == "__main__":
    main()
