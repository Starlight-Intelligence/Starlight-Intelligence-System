# Capability index

Third-party `SKILL.md` and `AGENTS.md` files, indexed from pinned public commits: provenance, license, security flags, near-duplicates, a searchable SQLite projection and a foundry capability graph. Draft, for issue frankxai/agentic-ops#554. Python 3.13 standard library only; no network, no model calls.

Receipts (`data/receipts.jsonl`) are canonical and validated by `foundry/contracts/capability-receipt.schema.json`. The SQLite/FTS5 index, the graph and the reports are derived and rebuildable. Artifact bodies are read from a pinned clone's git object store (blob SHA re-checked) and never written out. Third-party text is data, never instructions.

Run from this directory. Clone each repo in `sources.json` at its pinned commit into `<clones>/<slug>` first.

```bash
python3 -I capintel.py ingest --clones <clones> --observed-at 2026-11-10
python3 -I capintel.py build-db
python3 -I capintel.py graph            # canonical nodes plus aliases, per the foundry capability-graph contract
python3 -I capintel.py query "animation easing" --estate external --license-status allowlisted
python3 -I capintel.py dupes
python3 -I capintel.py eval --clones <clones> --lint <starlight-evals>/scripts/lint-skills.mjs
```

Tests, from the repository root: `python3 -B -m unittest discover -s foundry/capability-index/tests -p 'test_*.py'`, then `node --test test/capability-index.test.mjs` (validates the data with the foundry validator). CI runs both as the `capability-index` job. There is deliberately no npm script: the foundry validator closure pins the exact bytes of `package.json`.

`sources.json` pins 15 external and 2 baseline repositories by full SHA. `data/` holds receipts, sketches, conflict candidates and the graph. `evals/` holds the preregistration with its hash, labeled fixtures and results. Search is lexical (all terms must match). `data/skipped.jsonl` lists artifacts left out because of an unsafe or secret-shaped path or an unhashable size, by path hash only. Outcome records (`capintel.py outcome`) are append-only and marked `verified: false`; nothing reads them yet. See `RESULTS.md` for what was verified and what was not done.
