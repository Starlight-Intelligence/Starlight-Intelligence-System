"""Post-hoc (not preregistered) check: false positives of the lint-skills.mjs secret patterns vs anchored ones.

Usage: python3 -I secret_fp_check.py <sources.json> <clones_dir>
Counts SKILL.md/AGENTS.md lines matched by each pattern set at the pinned commits. A line matched only by the
naive set is a false positive when the match sits inside a longer word.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

sources, clones = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import capintel as c  # noqa: E402

naive = [re.compile(p) for p in c.SECRET_PATTERNS_NAIVE]
res = {"naive_files": 0, "anchored_files": 0, "naive_only_files": 0, "examples": [], "scanned": 0}
for s in json.loads(sources.read_text(encoding="utf-8"))["sources"]:
    clone = clones / s["slug"]
    for path, (mode, blob) in c.tree_entries(clone, s["commit"]).items():
        if path.rsplit("/", 1)[-1] not in c.ARTIFACT_NAMES or mode not in ("100644", "100755"):
            continue
        data = c.read_verified(clone, path, blob)
        if len(data) > c.MAX_BYTES:
            continue
        res["scanned"] += 1
        text = data.decode("utf-8", "replace")
        n = any(rx.search(text) for rx in naive)
        a = any(rx.search(text) for rx in c.SECRET_RE)
        res["naive_files"] += n
        res["anchored_files"] += a
        if n and not a:
            res["naive_only_files"] += 1
            if len(res["examples"]) < 5:
                res["examples"].append(f"{s['slug']}:{path}")
print(json.dumps(res, indent=1))
