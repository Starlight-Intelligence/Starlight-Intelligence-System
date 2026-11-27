# Results: capability index in SIS foundry (2026-11-20)

Moved from frankxai/agentic-ops#564 to `foundry/capability-index/` on the owner's decision. Everything below was run in this session from pinned clones. Sources: `sources.json` (15 external, 2 baseline repos, full SHAs). No model calls, no paid resources, no credentials changed, no deploys.

## Verified

| Gate | Evidence |
|---|---|
| 100 real source artifacts with provenance | `data/receipts.jsonl`: 100 external receipts from 15 repos (94 `SKILL.md`, 6 `AGENTS.md`). Each has repo URL, full commit SHA, path, git blob SHA verified at the pinned commit, content SHA-256, flags and a license verdict. License evidence (LICENSE blob SHA and path) exists for 85 of 100; 83 are allowlisted from a license file, 2 are allowlisted from frontmatter alone (no file), 13 have no license information, 2 have an adjacent license file we do not recognize (both `unknown`, which blocks packing). Plus 160 baseline-estate receipts. |
| Deduplicated capability metadata | `capintel.py dupes` (all near-duplicate pairs) and `aliases` in `data/capability-graph.json`. Exact match by normalized SHA-256 (bodies under 20 words match only on identical bytes), near match by bottom-128 shingle sketch at the absorb gate threshold 0.85. The graph merges copies into one canonical node with `aliases` only when they share a name, a security verdict and a license outcome, so a blocked or unlicensed copy is never hidden behind a clean one (4 canonical nodes absorb 8 copies). Merged copies need not be identical (the six `impeccable` copies score 0.977 to 0.992). Differently named near-duplicates stay separate nodes, because they can be different skills (`create-specification` and `update-specification` score 0.93); a human decides those. |
| Working query/search interface | `capintel.py build-db` then `query`: SQLite FTS5, filters on estate/kind/license status/no-blocked, FTS syntax input escaped, every printed field a JSON string literal. Lexical AND only: "postgres row level security" returns nothing from the 100-sample. |
| Graph export | `data/capability-graph.json`: 246 skill nodes, accepted by SIS's own foundry validator (`validateValue` with the `capability-graph` contract, including its alias-collision, duplicate-node and dangling-edge rules) in `test/capability-index.test.mjs`; a Python test also checks that the committed graph is exactly what the committed receipts produce. The canonical node of a merged group is our own estate's copy when there is one, otherwise the lexically smallest id; ids of colliding copies carry a suffix derived from the path, so they do not change when a file is edited. `status: registered` only means the skill is listed: it says nothing about vetting, so consult the receipt's verdict and license. `generatedAt` is the newest commit date, and ingest now fails if a `commit_date` in `sources.json` differs from the clone (this caught a 7-second error). Provenance, license and security facts are not in the graph (the schema cannot hold them); they live in receipts validated by the `capability-receipt` contract. **Correction:** an earlier draft of this work (frankxai/agentic-ops#564) claimed the graph "validates unmodified" after a generic JSON Schema check only. SIS's validator rejected it with 36 alias-collision errors, because it listed near-duplicates as separate nodes that aliased each other. Fixed here. |
| Three reproducible evaluations | `evals/results.json`; thresholds preregistered in `evals/prereg.json` (hash enforced by the runner); offline. See below and the caveats. |
| Reproducibility | Two ingests give byte-identical receipts, sketches and conflicts; SQLite `iterdump` hash identical across runs (covered by a test); an independent reviewer reproduced the committed data byte for byte. |
| Tests | 49 Python unit tests and 11 Node tests. Python: planted near-duplicate and conflict, license resolution, symlink exclusion, oversize, sanitization, CRLF checkout, FTS-injection input, preregistration tamper, regressions for every review finding, alias rules, committed graph equals regenerated graph. Node: the committed data validated by SIS's validator, plus 17 mutations the receipt contract must reject (unknown field, malformed hash, verdict that disagrees with its flags, license status that disagrees with its value, impossible date, path traversal, control characters, too many flags). SIS's existing foundry suite (`test:foundry`, 55 tests) is unchanged and green. Run by the `capability-index` job in `capability-foundry.yml`. |

### Evaluations (all pass their preregistered criteria; offline, deterministic) and their limits

- **E1, conformance vs the existing linter.** Our frontmatter, dollar-digit and secret checks vs `starlight-evals/scripts/lint-skills.mjs` on 94 external skills: overall agreement 0.9929 over 282 (file, rule) pairs, threshold 0.95. That figure is inflated by true negatives. On the 13 pairs where either side reported a finding, agreement is 0.846. The 2 disagreements are the oracle's: it does not strip YAML quotes, so `name: "openai-docs"` is reported as not matching folder `openai-docs`. This is the only evaluation with an independent oracle.
- **E2, distinctness vs our estate.** Sketch Jaccard vs exact 5-word-shingle Jaccard on 135 pairs (150 preregistered; fewer pairs qualified): max error 0.029, 100% within 0.10. Both sides share the same tokenizer and hash, so this measures only sketch sampling error; `absorb.mjs` itself was not run. 3 of 94 external skills overlap our estate at >= 0.5; the existing name-collision check misses 0 of them. **No improvement over name-collision on this sample.**
- **E3, injection scanner on labeled fixtures (30 synthetic cases).** Naive phrase match: recall 1.00, false-positive rate 0.611. Context-aware: recall 0.833, false-positive rate 0.056. Caveats: the fixtures are authored by the scanner's author; the first run failed the preregistered recall threshold (0.75), the shared regex was fixed (not the thresholds) and the second run passed at 0.833 vs 0.80, so this is not a clean out-of-sample result; the "naive" baseline is our own regex without context, because `lint-skills.mjs` has no injection rule.

### Improvement over baseline

The one improvement measured against a real existing baseline is small: the `lint-skills.mjs` secret patterns flag 2 of 2,021 real files, both false positives (`sk-` inside the skill name `task-coordination-strategies`; `re_` inside the identifier `Feature_CoversMultipleRequirements`); anchored patterns flag 0 (`evals/secret_fp_check.py`, post-hoc, not preregistered). No genuine secret exists in the corpus.

Not baseline comparisons, but real-data observations from the full-corpus run (1,805 external files, not committed, reproducible with `ingest --all`):
- 6 files contain injection phrases; all verified by reading to be defensive text. They are kept as `info` and the verdict is `review`, never `clean`.
- License detection (new; `absorb.mjs` takes a caller-asserted string): 921 allowlisted, 11 refused, 873 unknown (851 in `ComposioHQ/awesome-claude-skills`, which has no license file).
- Duplicates: 12 clusters over 45 files (one of 22 is the same skill vendored into per-harness directories). Name-only matching would see all but 2 of 248 pairs (Composio's `artifacts-builder` is a 0.992 near-copy of Anthropic's `web-artifacts-builder`).

### Review findings (independent adversarial review) and fixes

Fixed with regression tests, each reproduced from the reviewer's crafted input:
1. A secret preceded by a non-ASCII character was stored verbatim (the guard ran on ASCII-escaped JSON). Secrets are now redacted at the source and the guard checks unescaped text.
2. Any line containing `lint-allow:` skipped every check. Third-party text can no longer exempt itself (only the cosmetic dollar-digit rule honors it).
3. Injection bypasses: a defensive cue word hid an exfiltration request; phrases split across lines or in a folded description were missed; a U+FEFF inside a phrase evaded matching. Now scanned on whitespace-collapsed, invisible-character-stripped text including the description; sensitive targets or exfiltration verbs defeat the defensive discount; a discounted hit gives verdict `review`, never `clean`.
4. License fail-open: Business Source and similar licenses resolved as Apache; an unrecognized license file was upgraded by frontmatter `MIT`; `OR` expressions resolved nondeterministically; non-allowlisted frontmatter never conflicted with an MIT file. Now refused, unknown, deterministic and conflict respectively.
5. Graph ID collisions and self-aliases on the full corpus (3+ identical copies); 6. crash on a root-level skill with no name; 7. raw artifact paths printed by `query` (terminal escape injection); 8. unrelated non-Latin short bodies clustered as exact duplicates.

Earlier bugs found by running on real data: the shared regex missed "disregard your previous instructions"; the unanchored secret prefix tripped the fail-closed guard on a real file; zero-width joiners in emoji gave 2 false "blocked" verdicts; the editor tool wrote invisible raw characters into source files (replaced with explicit escapes, files checked ASCII-only).

Windows portability (owner's cross-harness review of `a4d804c`; reproduced, then fixed):
- A CRLF checkout made every read fail ("blob mismatch"), because content was read from the working tree. Content is now read from git's object store by blob SHA (hash re-checked, SHA format validated), so checkout line endings, local edits and symlinks cannot change receipts. Regression test rewrites the worktree with CRLF and local edits and expects byte-identical receipts. This replaces the earlier "tampered worktree fails closed" behavior, which was a side effect of the old read path.
- All text file I/O is explicit UTF-8, outputs are written with LF endings, the linter output is decoded as UTF-8 and its paths normalized to `/`, and `.gitattributes` forces LF so the preregistration hash and byte-identical exports hold on a Windows checkout.
- Symlink and hostile-filename tests skip where the platform cannot create them. **Not run on Windows**: the CRLF case was simulated on Linux, so Windows behavior is unverified.

Second independent review (of this change in SIS; approve with changes), all fixed with a regression test unless noted:
1. Two regexes backtracked super-linearly (`<!--ignore` repeated: 117 s for 20 KB). They are now bounded, lines are scanned only up to 4,000 characters and flagged `long_line`, and a test requires pathological lines to scan in bounded time.
2. A blocked copy could become the canonical node, hiding behind a clean alias. Merging now requires the same verdict and license outcome; our own estate's copy wins; the collision suffix no longer depends on file content.
3. `query` printed the `cluster` field raw (terminal escape injection). Every field is now a JSON string literal, covered by a test that plants escapes in each field. Paths with control characters or invalid UTF-8 are now skipped at ingest.
4. License detection read only the first 20 KB, so a restriction after padding resolved as MIT. Whole files are read (up to 200 KB; larger files are `unrecognized`) and more restriction markers are recognized. Detection is still phrase-based: restrictive wording outside the marker list is not caught, and unrecognized text blocks packing (`unknown`) rather than being understood.
5. Output and contract disagreed: truncation used code points while the validator counts UTF-16 units, and `allowed_tools` was never cleaned. Both fixed; extra secret shapes (`xox*`, `AIza`, `glpat-`, `npm_`, `sk_live_`) are now redacted and flagged.
6. One hostile filename aborted the whole ingest. A secret-shaped or invalid path now skips that artifact and is recorded by path hash in `data/skipped.jsonl`.
7. A 250 KB file produced 21,000 flags and blobs were read before the size check. Flags are capped at 200 plus a `flags_truncated` marker, size is checked first, oversize files are hashed by streaming, and files over 64 MB are skipped.
8. The receipt contract was too loose. It now enforces verdict-versus-flags and license-status-versus-value consistency, calendar dates, safe paths, flag count, and the Node test checks that every `artifact_id` matches its source.
9. CI could not tell a hand-edited graph from a generated one; the committed graph must now equal the regenerated one.
10. `generatedAt` was 7 seconds off a hand-entered commit date; ingest now verifies commit dates.

Known limits left as they are:
- The defensive discount is still evadable by a determined attacker (the evasion stays visible as `info`/`review`, and exfiltration wording defeats it). Scanning is regex-based and is not a security boundary.
- License and injection detection are phrase-based heuristics. They are not a security or legal review.
- Conflict detection drops directives with fewer than 3 content tokens (`Always use tabs.` vs `Never use tabs.` is missed). It found 0 candidates in the 260-artifact set and 2 (unreviewed) in the 1,965-file scratch run; recall is evidenced only on planted pairs and precision is unmeasured.

## Not done / not verified

- Not built: MCP manifest ingestion, composition recommendations, learning from outcomes (the outcome record exists but affects nothing and its writers are unauthenticated), capability pack production, model-in-the-loop skill evaluations, scheduled ingestion, Cloudflare/D1 deployment, Vercel surface. Issue gates for weekly evidence brief, adoption scorecards and a skill-improvement PR are not met.
- Index covers 100 sampled artifacts, not the 10,000-candidate target. Popularity and trending sources (skills.sh, skillleaderboard.com) are blocked by the environment proxy; GitHub REST for unattached repos is blocked, so coverage came from anonymous clones of 15 named repos.
- Not inspected: `starlight-agent-config`, `starlight-playbooks`, `frankxai/claude-code-config` (not anonymously readable); `AI-Architect-Studio/agentic-ops` (same-name checkout conflict). The "weekly Starlight Skills Intelligence automation" was not found in accessible repositories.
- Independent review: a fresh-context higher-tier model reviewed the ADR and then this code (findings above). No second model provider was reachable in this environment, so cross-provider verification is not done.

## Cost

No model, hosting or API spend by this code. Wall time: ingest of 260 artifacts about 4 s and of all 1,965 about 25 s (blobs are read through `git cat-file`), Python tests about 4 s. Session cost in dollars is unknown (no billing data available); the harness reported about 912k subagent tokens for the earlier slice and about 223k for the review of this change.
