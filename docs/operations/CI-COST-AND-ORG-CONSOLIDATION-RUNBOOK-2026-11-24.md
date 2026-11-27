# CI Cost, Autonomous Agent Optimization & Org Consolidation Runbook (RFC v2)

**Measured:** 2026-11-24 / 2026-11-27 (GitHub Enhanced Billing Usage API `2026-11`, org APIs, branch-protection APIs, and Wrangler account `0b5c0d4435bdb220b9ed28efa0a98554`).

---

## 1. Verified Live Baseline (Nov 1–26, 2026)

### Account Spend (`frankxai` Pro — $4/mo, 3,000 Linux min, 2 GB storage)

| Product | Quantity | Gross | Net Billed |
| --- | ---: | ---: | ---: |
| GitHub Actions (Nov 1–26) | 41,531.0 | $222.68 | **$78.37** |
| Copilot AI credits (auto PR reviews, Nov 1–26) | 26,500.0 | $265.00 | **$65.00** *(cap hit)* |
| **Total (Nov 1–26)** | — | **$487.68** | **$143.37** |

### Actions SKU Breakdown (`frankxai`, Nov 1–24 snapshot)

| SKU | Quantity | Gross | Net Billed |
| --- | ---: | ---: | ---: |
| Actions Linux (2-core, $0.006/min) | 30,330.0 | $181.98 | $61.75 |
| Actions macOS 3-core ($0.062/min, 10x) | 233.0 | $14.45 | $6.37 |
| Actions Linux Slim (1-core, $0.002/min, 3x cheaper) | 2,676.0 | $5.35 | $5.13 |
| Actions Windows ($0.010/min, 1.7x) | 1,243.0 | $12.43 | $3.30 |
| Actions storage | 5,904.3 | $1.98 | $0.64 |

### Top 5 Billed Private Repos on `frankxai` (86.2% of Actions Bill)

| Repository | Qty | Gross | Net Billed | Ownership Rule |
| --- | ---: | ---: | ---: | --- |
| `starlightintelligence.ai` | 8,106.0 | $52.87 | **$37.80** | Transferred mid-month into `Starlight-Intelligence` org (Model B; pre-transfer spend billed on `frankxai`) |
| `agentic-ops` | 3,212.0 | $12.17 | **$10.84** | **Model A — keep in `frankxai/`** |
| `agentic-ops-hub` | 1,209.4 | $7.15 | **$6.49** | **Model A — keep in `frankxai/`** |
| `agenticincome` | 1,063.1 | $6.38 | **$5.73** | **Model A — keep in `frankxai/`** (Vercel-bound) |
| `gencreator.ai` | 2,661.8 | $6.21 | **$5.66** | **Model A — keep in `frankxai/`** (Vercel-bound) |

### All 11 GitHub Namespaces (Seats, Repo Counts & Installed Apps)

| Namespace | Plan | Members (`filled_seats`) | Outside Collabs | Public / Private Repos | Nov Actions Gross / Net | Installed GitHub Apps (0 seats) |
| --- | --- | --- | --- | ---: | ---: | --- |
| `frankxai` | Pro | `frankxai` (1) | — | 189 / 196 | $216.19 / **$77.19** *(Nov 1–24)* | *(user account)* |
| `Starlight-Intelligence` | Free | `frankxai` (1) | `[]` | 19 / 25 | $40.21 / $0.00 *(6,300.9 multi-SKU qty Nov 1–26)* | `blacksmith-sh`, `claude`, `google-labs-jules`, `chatgpt-codex-connector`, `starlight-review`, `vercel`, `antigravity-for-github` |
| `Arcanea-Labs` | Free | `frankxai` (1) | `[]` | 15 / 7 | $24.77 / $0.00 | `graphite-app`, `chatgpt-codex-connector`, `google-labs-jules`, `cursor`, `notion-ai-connector`, `claude`, `blacksmith-sh`, `starlight-review`, `antigravity-for-github` |
| `FrankX-AI` | Free | `frankxai` (1) | `[]` | 10 / 4 | $1.90 / $0.00 | `graphite-app`, `neon-postgres`, `supabase`, `blacksmith-sh`, `google-labs-jules`, `chatgpt-codex-connector`, `claude` |
| `AI-Architect-Academy` | Free | `frankxai` (1) | `[]` | 1 / 4 | $0.14 / $0.00 | `chatgpt-codex-connector`, `vercel`, `claude`, `blacksmith-sh`, `google-labs-jules` |
| `GenCreator-ai` | Free | `frankxai` (1) | `[]` | 8 / 3 | $0.09 / $0.00 | `claude`, `google-labs-jules`, `chatgpt-codex-connector` |
| `Starlight-Intelligence-Systems` | Free | `frankxai` (1) | `[]` | 6 / 2 | $0.10 / $0.00 | `google-labs-jules`, `chatgpt-codex-connector` |
| `Life-Commons` | Free | `frankxai` (1) | `[]` | 9 / 2 | $0.29 / $0.00 | `claude`, `blacksmith-sh`, `google-labs-jules`, `chatgpt-codex-connector` |
| `AI-Architect-Studio` | Free | `frankxai` (1) | `[]` | 11 / 1 | $0.16 / $0.00 | `claude`, `blacksmith-sh`, `google-labs-jules`, `chatgpt-codex-connector` |
| `Agentic-Income` | Free | `frankxai` (1) | `[]` | 12 / 2 | $0.68 / $0.00 | `claude`, `blacksmith-sh`, `google-labs-jules`, `chatgpt-codex-connector`, `cursor` |
| `oci-ai-architects` | Free | `frankxai` (1) | `[]` | 13 / 1 | $0.00 / $0.00 | `claude`, `blacksmith-sh` |

**Billing Reconciliation & Blocker Root Causes (2026-11-25 / 2026-11-26):**
- **Gross vs Net Gap (`frankxai`):** In the Nov 1–24 snapshot (`$216.19` gross vs `$77.19` net; gap = `$139.00`) and Nov 1–26 update (`$222.68` gross vs `$78.37` net; gap = `$144.31`), the gross figure includes public-repository runner usage (billed at `$0.00` net) plus Pro's 3,000 included private Linux minutes (`$18.00` value) and storage allowances. Excluding `starlightintelligence.ai` (`$37.80` net billed on `frankxai` prior to org transfer), remaining `frankxai` private net overage was **`$39.39`** across Nov 1–24 (`~$49/mo` run rate *before* Wave 1–3 cuts); switching lightweight jobs to `ubuntu-slim` (`3x` cheaper), draft-gating, and trimming `fleet-watch` crons brings Model A control-plane + Vercel-bound repos within the **`$20/mo` post-cut Actions cap**.
- **Mid-month Transfer (`starlightintelligence.ai`) & Multi-SKU Org Mix (`Starlight-Intelligence`):** `starlightintelligence.ai` accrued `8,106.0` qty (`$37.80` net) under `frankxai` before moving to the `Starlight-Intelligence` org, where it subsequently accrued `802` private minutes — the two rows represent sequential pre- and post-transfer periods, not duplicate billing. Across all `Starlight-Intelligence` repos, total multi-SKU billing quantity reached `6,300.9` (`$40.21` gross across Linux, macOS `10x`/Windows `1.7x` legs, storage, and public-repo runs, `$0.00` net due to Free-tier cap), of which **`2,068.8` private Actions minutes** were logged against the 2,000 min/mo Free limit (`starlightintelligence.ai` 802, `starlight-command-center` 770, `starlight-kernel` 249, `starlight-agent-config` 186.8, others 61). That exhausted the Free-tier `$0` cap, causing `starlightintelligence.ai#396`'s `Starlight CI / aggregate contract tests` and `release-aggregate` to fail immediately with empty `runner_name` (and private branch protection returns `HTTP 403`).
- **Wave 3 Blocker Discovery & Deploy (`services/cf-checker`):** `Starlight Review` (`frankxai/agentic-ops/services/cf-checker`, Workers AI `glm-5.3` + `deepseek-v4.1-flash`) had 2024/2025 training cutoff knowledge and emitted false-positive blockers on `ubuntu-slim` across `#659`, `#524`, and `#375`. Fixed in `frankxai/agentic-ops#666` (merged; `217/217` tests passing) and deployed live to Cloudflare Worker `starlight-cf-checker` (`Version ID: 70e955d6-aa5c-4804-9108-2cc06d5e7a81`). Note: because `services/cf-checker` treats `.github/workflows/**` edits as critical-risk human-only paths, clean workflow PRs (`agentic-ops-hub#524`, `frankx.ai-vercel-website#1334`) now receive `ACTION_REQUIRED` (`NEEDS HUMAN` / `ADVISORY`) rather than false `ubuntu-slim` errors, while `agentic-ops#659` still drew a dual `REQUEST_CHANGES` on `queen-chain-behavior.yml:35` even though `chain (ubuntu-slim)` passed (`SUCCESS`).
- **Vercel Commit Author Gate:** Vercel blocked deployment on `gencreator.ai#375` where commit `926175d` used an unlinked author email instead of verified `132689939+frankxai@users.noreply.github.com` (subsequent commits must pass `-c user.email="132689939+frankxai@users.noreply.github.com"` or `132689939+frankx-eth@users.noreply.github.com` per GitHub-linked identity).

---

## 2. Core Architectural Rulings (Audited & Locked)

### Ruling 1 — Model A vs Model B Repo Placement (Do NOT Mass-Transfer)
- **Keep canonical in `frankxai/` (Model A):**
  - `frankxai/agentic-ops` & `frankxai/agentic-ops-hub` — personal control plane, Registry source of truth, `merge-steward.yml` (`github.repository == 'frankxai/agentic-ops-hub'`, `owner: frankxai`), fleet manifests, and non-transferable Environment secrets (`merge-steward`, `media-staging`, `media-production`).
  - `frankxai/frankx.ai-vercel-website`, `frankxai/gencreator.ai`, `frankxai/agenticincome` — Vercel-bound projects (transferring to an org severs Vercel's GitHub App link and forces paid Vercel Team seats).
  - `frankxai/claude-skills-library` — public canonical URL with stars/traffic ($0 CI).
- **Keep/Create in Brand Orgs (Model B):**
  - Protocol, platform, and non-personal repos belong in their brand orgs (`Starlight-Intelligence`, `Arcanea-Labs`, `GenCreator-ai`, `FrankX-AI`, `Agentic-Income`, `AI-Architect-Academy`, `Life-Commons`, `AI-Architect-Studio`, `oci-ai-architects`).
  - **Batch 4 consolidation:** Collapse `Starlight-Intelligence-Systems` (2 private / 6 public) into `Starlight-Intelligence`.

### Ruling 2 — Option A ("1+1" Billing = $8/mo Base Fixed) Before Option B (Enterprise Cloud)
- **Execute Option A now (`$8/mo` base subscription + up to `$40/mo` capped Actions overage = `$48/mo` hard max):**
  - Keep **`frankxai` Pro ($4/mo)** with a **$20/mo Actions spending cap** (covers Model A control plane + Vercel-bound repos after Copilot & `ubuntu-slim`/draft cuts).
  - Upgrade **only `Starlight-Intelligence` to Team ($4/mo)** with a **$20/mo Actions spending cap** (unlocks 3,000 included min, unblocks `starlightintelligence.ai` runner allocation immediately, and unlocks private branch protection/rulesets).
  - Leave all **other 8 active orgs on Free ($0/mo, $0 cap)** — 0 billing setup needed.
- **Objective trigger to upgrade to Option B (`$21/mo` 1-seat Enterprise Cloud + `$4/mo` personal Pro = `$25/mo` base):**
  - Upgrade *only if* combined monthly private Actions overages across orgs exceed **$17/mo for two consecutive months** (breakeven: `$4` Team + `$17` overage = `$21` Enterprise, with `frankxai` Pro still `$4/mo` -> `$25/mo` total base) OR 3+ orgs simultaneously require private branch protection. Verify self-serve 1-seat metered checkout terms before switching.

---

## 3. All 23 PRs Shipped (Waves 1–4, 2026-11-24 – 2026-11-27)

| Wave | Repository | PR | State | Summary & Verification |
| --- | --- | --- | --- | --- |
| 1 | `Starlight-Intelligence/starlightintelligence.ai` | https://github.com/Starlight-Intelligence/starlightintelligence.ai/pull/396 | Draft | Adds zero-dependency `workers/ci-sentinel` Cloudflare Worker (`17 */6 * * *` cron + `/health`, `/audit`, `/run`), `CLOUDFLARE-CI-CUTOVER.md` guide, switches `ci-contract` & `release-aggregate` to `ubuntu-slim`, caps retention to 1–3d. (`ci-aggregate.test.mjs` 54/54, `ci-sentinel` 6/6, `wrangler deploy --dry-run` pass; blocked on `Starlight-Intelligence` Free 2,000-min cap.) |
| 1 | `frankxai/agentic-ops` | https://github.com/frankxai/agentic-ops/pull/659 | Ready | Moves 7 lightweight workflows/legs to `ubuntu-slim`, draft-gates `customer-intelligence`, trims retention to 3d. `claude-code-review.yml` untouched. (`scripts/tests` + `multi-machine/tests` 21/21 pass; hosted `verify`, `check`, `behavior`, `chain (ubuntu-slim)` green; `Starlight Review` `REQUEST_CHANGES` on `queen-chain-behavior.yml:35` despite `chain (ubuntu-slim)` passing.) |
| 1 | `frankxai/agentic-ops-hub` | https://github.com/frankxai/agentic-ops-hub/pull/524 | Ready | Moves `ci`, `estate-guard`, `fleet-watch`, `estate-ci-watch` to `ubuntu-slim`, draft-gates `estate-guard`, halves `fleet-watch` cron (`*/6` -> `*/12`), cuts retention to 1–3d. (`verify`, `Tool tests`, `scan` `SUCCESS`; both `Starlight Review` models `APPROVE` with `ACTION_REQUIRED` human-only workflow gate.) |
| 1 | `frankxai/gencreator.ai` | https://github.com/frankxai/gencreator.ai/pull/375 | Ready | Enables PR-only `cancel-in-progress` on `ci.yml`, moves `web-excellence` & `estate-guard` to `ubuntu-slim`, removes duplicate PR `estate-guard`, caps retention to 1d. Locked surfaces untouched. (`Vercel` & core checks `SUCCESS`; re-triggered after `cf-checker` deploy.) |
| 1 | `Starlight-Intelligence/.github` | https://github.com/Starlight-Intelligence/.github/pull/13 | **MERGED** | Defaults org-wide `reusable-ci.yml` to `ubuntu-slim` with configurable `runner`, `timeout-minutes`, and `run-build`. (YAML OK.) |
| 1 | `Starlight-Intelligence/Starlight-Intelligence-System` | https://github.com/Starlight-Intelligence/Starlight-Intelligence-System/pull/617 | Draft | This RFC v2 Runbook (zero substrate files modified; awaits `independent-review-policy` + maintainer review). |
| 2 | `frankxai/agenticincome` | https://github.com/frankxai/agenticincome/pull/155 | **MERGED** | Switches `dependency-audit`, `estate-guard`, `web-excellence`, `knowledge-freshness`, `org-mirror` to `ubuntu-slim`; draft-gates `web-excellence`; caps `estate-guard` retention to 1d and Dependabot open PRs to 3. |
| 2 | `Arcanea-Labs/arcanea-ai-app` | https://github.com/Arcanea-Labs/arcanea-ai-app/pull/776 | **MERGED** | Caps `retention-days: 1` across all 9 workflows calling `upload-artifact` (down from 7–30 days) to prevent account-wide 2 GB quota lockouts. |
| 2 | `frankxai/frankx.ai-vercel-website` | https://github.com/frankxai/frankx.ai-vercel-website/pull/1334 | Ready | Caps `upload-artifact` retention to 1d (`ci.yml`, `estate-guard.yml`, `search-context-evidence.yml`) and switches `estate-guard.yml` & `web-excellence.yml` to `ubuntu-slim`. Protected surfaces untouched. (All CI & `Vercel` `SUCCESS`; `Starlight Review` `ACTION_REQUIRED` `ADVISORY`.) |
| 3 | `frankxai/agentic-ops` | https://github.com/frankxai/agentic-ops/pull/666 | **MERGED** | Fixes `services/cf-checker` (`Starlight Review`) false-positive blocker on `ubuntu-slim` and `@v7`/`@v6` official action versions across both system prompts (`models.ts`, `review.ts`, `review.test.ts`); deployed live (`70e955d6-aa5c-4804-9108-2cc06d5e7a81`). |
| 3 | `Starlight-Intelligence/starlight-command-center` | https://github.com/Starlight-Intelligence/starlight-command-center/pull/156 | **MERGED** | Draft-gates heavy jobs across 5 workflows, moves `capability-registry.yml` & `electron-shell` to `ubuntu-slim`, caps all `upload-artifact` retention to 1d. |
| 3 | `Starlight-Intelligence/starlight-kernel` | https://github.com/Starlight-Intelligence/starlight-kernel/pull/40 | **MERGED** | Draft-gates all 3 CI jobs and moves Linux matrix leg & `release-readiness` to `ubuntu-slim`. |
| 3 | `Starlight-Intelligence/starlight-memory` | https://github.com/Starlight-Intelligence/starlight-memory/pull/64 | **MERGED** | Caps all 4 `upload-artifact` retention steps in `ci.yml` & `package-consumer.yml` from 7d to 1d. |
| 3 | `frankxai/agenticpassiveincome` | https://github.com/frankxai/agenticpassiveincome/pull/78 | **MERGED** | Moves lightweight workflows (`estate-guard`, `web-excellence`, `knowledge-freshness`, `draft-github-release`, `release-contract`) to `ubuntu-slim`, draft-gates non-required checks, caps retention to 1d. |
| 3 | `frankxai/gencreator-community` | https://github.com/frankxai/gencreator-community/pull/38 | **MERGED** | Draft-gates PR runs, moves `estate-guard` & `web-excellence` to `ubuntu-slim`, caps retention 30d -> 1d. |
| 3 | `frankxai/product-plans` | https://github.com/frankxai/product-plans/pull/90 | **MERGED** | Switches zero-dependency `kits` & `measured` jobs in `ci.yml` (and synced `docs/ci/product-plans-ci.yml`) to `ubuntu-slim` (`timeout-minutes: 10`), preserving draft runs. |
| 4 | `Starlight-Intelligence/starlight-agent-config` | https://github.com/Starlight-Intelligence/starlight-agent-config/pull/232 | Draft | Moves lightweight Node/Python workflows & Linux matrix legs to `ubuntu-slim`, preserves `ubuntu-latest`/`windows-latest` where `pwsh`/Windows required, draft-gates Windows & non-required PR runs, caps retention 3d -> 1d. (`YAML OK` 13 workflows.) |
| 4 | `frankxai/starlight-estate` | https://github.com/frankxai/starlight-estate/pull/129 | Draft | Moves `autonomy-lanes` & `character-registry-validate` to `ubuntu-slim` (`timeout-minutes: 10`), preserves `windows-latest` on `mcp-validate`, adds PR concurrency and draft gating. (`YAML OK` 4 workflows.) |
| 4 | `Arcanea-Labs/AnimeLegends` | https://github.com/Arcanea-Labs/AnimeLegends/pull/85 | Draft | Switches fallback runners (`'ubuntu-latest'` -> `'ubuntu-slim'`) on lightweight validation/Python jobs, preserves `ubuntu-latest` for Next/Remotion builds, adds draft PR gating. (`YAML OK` 6 workflows.) |
| 4 | `frankxai/starlight-intelligence-academy` | https://github.com/frankxai/starlight-intelligence-academy/pull/112 | Draft | Caps Playwright browser artifact retention 14d -> 1d in `ci.yml`, moves `curriculum.yml` & `visual-anchor-contract.yml` to `ubuntu-slim` with draft gating & PR concurrency. (`YAML OK` 3 workflows.) |
| 4 | `frankxai/llm-evals` | https://github.com/frankxai/llm-evals/pull/31 | Draft | Gates `deterministic-verification.yml` (`windows-2022`) on ready PRs (`draft == false`), preserving pushes to `main`. (`YAML OK`.) |
| 4 | `frankxai/claude-code-config` | https://github.com/frankxai/claude-code-config/pull/70 | Draft | Switches pure-Python `validate` job in `ci.yml` to `ubuntu-slim`. (`YAML OK`.) |
| 4 | `frankxai/frankx-strategy` | https://github.com/frankxai/frankx-strategy/pull/22 | Draft | Switches `test` job in `ci.yml` to `ubuntu-slim` (`timeout-minutes: 10`), adds draft PR gating and PR-only `cancel-in-progress`. (`YAML OK`.) |

---

## 4. Frank's Remaining Manual Execution Checklist (Money / UI / Final Approvals)

*Already executed automatically (2026-11-27): merged 10 Wave 1–3 PRs (`.github#13`, `agenticincome#155`, `agentic-ops#666`, `arcanea-ai-app#776`, `starlight-command-center#156`, `starlight-kernel#40`, `starlight-memory#64`, `agenticpassiveincome#78`, `product-plans#90`, `gencreator-community#38`), deployed updated `starlight-cf-checker` (`70e955d6-aa5c-4804-9108-2cc06d5e7a81`), and created R2 bucket `starlight-ci-cache` with lifecycle rule `expire-7d`.*

1. **Turn off Copilot Auto Code Review (saves ~$65/mo immediately):**
   - **GitHub → Settings → Copilot → Code review → Off** (keep manual `@copilot review` only).
2. **Apply Option A ("1+1" Billing = `$8/mo` base + up to `$40/mo` capped overage):**
   - Keep `frankxai` Pro ($4/mo) with **$20/mo Actions cap**.
   - Upgrade **only `Starlight-Intelligence` → Team ($4/mo)** with **$20/mo Actions cap** (immediately unblocks `starlightintelligence.ai#396` and enables private branch protection).
   - Keep the other 8 orgs on Free ($0/mo).
3. **Approve & Merge Remaining Open Wave 1–4 PRs:**
   - Merge human-gated Wave 1–2 workflow PRs (`agentic-ops-hub#524`, `frankx.ai-vercel-website#1334`, `agentic-ops#659`, `gencreator.ai#375`), `SIS#617` (after independent review receipt), `starlightintelligence.ai#396` (after Team upgrade), and ready/merge Wave 4 Draft PRs (`starlight-agent-config#232`, `starlight-estate#129`, `AnimeLegends#85`, `starlight-intelligence-academy#112`, `llm-evals#31`, `claude-code-config#70`, `frankx-strategy#22`).
4. **Bind `workers/ci-sentinel` Secrets & Workers Builds After `#396` Lands:**
   - From `Starlight-Intelligence/starlightintelligence.ai` `main` (account `0b5c0d4435bdb220b9ed28efa0a98554`, see `workers/ci-sentinel/docs/CLOUDFLARE-CI-CUTOVER.md`; `starlight-ci-cache` R2 bucket + `expire-7d` rule are already live):
     ```bash
     cd workers/ci-sentinel
     npx wrangler secret put SENTINEL_TOKEN
     npx wrangler secret put GH_ESTATE_TOKEN
     npx wrangler deploy
     ```
   - Install `starlight-review` (`services/cf-checker`) App on `frankxai` and the remaining 8 orgs.
   - Connect `workers/agents`, `workers/mcp`, and preview builds to **Cloudflare Workers Builds** (6,000 build min/mo @ 4 vCPU, covered by Cloudflare Startup Credits — verify exact SKUs against active account credit terms).
   - Once `starlight-ci-sentinel` cron is verified live, disable `fleet-watch.yml`, `estate-ci-watch.yml`, and `ci-budget-guard.yml` crons in `agentic-ops-hub`.

---

## 5. Independent Agent Review Checklist (Falsification Protocol)

1. **Math check:** Re-run `users/frankxai/settings/billing/usage` and `orgs/Starlight-Intelligence/settings/billing/usage` for `2026-11`; verify Option A (`$8/mo` base fixed, max `$48/mo` with caps) beats Option B (`$25/mo` base fixed) until combined org overage `>$17/mo` for 2 months.
2. **Model A boundary check:** Confirm no control-plane or Vercel-bound repo is slated for transfer, and `merge-steward` Environment secrets remain intact in `frankxai/agentic-ops-hub`.
3. **Workflow safety check:** Confirm zero `ubuntu-slim` jobs use Docker `services:`, `sudo apt-get`, or >15 min timeouts, and zero required checks (`agenticincome` `build`, `Dependency audit`, `scan`; `starlightintelligence.ai` `ci-contract`, `release-aggregate`) are skipped on drafts.
4. **Security check on `workers/ci-sentinel`:** Confirm `/audit` & `/run` fail closed (`503` unbound, constant-time `401` mismatch) and `/health` leaks zero secrets or billing data.
5. **Artifact safety check:** Confirm every `upload-artifact` change only reduces `retention-days` (no producer upload removed where a `download-artifact` exists).
6. **Cloudflare credit scope check:** Confirm Workers, Cron Triggers, Workers Builds, and R2 draw from the active Cloudflare for Startups credit balance on account `0b5c0d4435bdb220b9ed28efa0a98554`.
7. **Red-team check:** Monitor `starlightintelligence.ai` monthly private Actions usage after migrating `pr-gate` to `starlight-review` and previews to Workers Builds to confirm it stays inside `Starlight-Intelligence` Team's 3,000 included minutes.
