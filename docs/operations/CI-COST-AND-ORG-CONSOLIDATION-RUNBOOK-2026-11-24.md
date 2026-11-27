# CI Cost, Autonomous Agent Optimization & Org Consolidation Runbook (RFC v2)

**Measured:** 2026-11-24 / 2026-11-27 (GitHub Enhanced Billing Usage API `2026-11`, org APIs, branch-protection APIs, and Wrangler account `0b5c0d4435bdb220b9ed28efa0a98554`).

---

## 1. Verified Live Baseline (Nov 1–26, 2026)

### Account Spend (`frankxai` Pro — $4/mo, 3,000 Linux min, 2 GB storage)

| Product | Quantity | Gross | Net Billed |
| --- | ---: | ---: | ---: |
| GitHub Actions (Nov 1–26) | 41,531.0 | $222.68 | **$78.37** |
| Copilot AI credits (auto PR reviews, Nov 1–26) | 26,500.0 | $265.00 | **$65.00** *(cap hit; Auto Review toggled **OFF** 2026-11-27)* |
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

## 3. All 27 PRs Shipped (Waves 1–5, 2026-11-24 – 2026-11-27)

| Wave | Repository | PR | State | Summary & Verification |
| --- | --- | --- | --- | --- |
| 1 | `Starlight-Intelligence/starlightintelligence.ai` | https://github.com/Starlight-Intelligence/starlightintelligence.ai/pull/396 | **MERGED** | Adds zero-dependency `workers/ci-sentinel` Cloudflare Worker (`17 */6 * * *` cron + `/health`, `/audit`, `/run`), `CLOUDFLARE-CI-CUTOVER.md` guide, switches `ci-contract` & `release-aggregate` to `ubuntu-slim`, caps retention to 1–3d. (`starlight-ci-sentinel` **deployed live** `05f61ff5-1a8d-4a2a-82d6-8fef3b381572`; `/health` `200`, `/audit` `503` fail-closed.) |
| 1 | `frankxai/agentic-ops` | https://github.com/frankxai/agentic-ops/pull/659 | **MERGED** | Moves 7 lightweight workflows/legs to `ubuntu-slim`, draft-gates `customer-intelligence`, trims retention to 3d. `claude-code-review.yml` untouched. |
| 1 | `frankxai/agentic-ops-hub` | https://github.com/frankxai/agentic-ops-hub/pull/524 | **MERGED** | Moves `ci`, `estate-guard`, `fleet-watch`, `estate-ci-watch` to `ubuntu-slim`, draft-gates `estate-guard`, halves `fleet-watch` cron (`*/6` -> `*/12`), cuts retention to 1–3d. |
| 1 | `frankxai/gencreator.ai` | https://github.com/frankxai/gencreator.ai/pull/375 | **MERGED** | Enables PR-only `cancel-in-progress` on `ci.yml`, moves `web-excellence` & `estate-guard` to `ubuntu-slim`, removes duplicate PR `estate-guard`, caps retention to 1d. Locked surfaces untouched. |
| 1 | `Starlight-Intelligence/.github` | https://github.com/Starlight-Intelligence/.github/pull/13 | **MERGED** | Defaults org-wide `reusable-ci.yml` to `ubuntu-slim` with configurable `runner`, `timeout-minutes`, and `run-build`. |
| 1 | `Starlight-Intelligence/Starlight-Intelligence-System` | https://github.com/Starlight-Intelligence/Starlight-Intelligence-System/pull/617 | Draft | This RFC v2 Runbook (zero substrate files modified; awaits `independent-review-policy` + maintainer review). |
| 2 | `frankxai/agenticincome` | https://github.com/frankxai/agenticincome/pull/155 | **MERGED** | Switches `dependency-audit`, `estate-guard`, `web-excellence`, `knowledge-freshness`, `org-mirror` to `ubuntu-slim`; draft-gates `web-excellence`; caps `estate-guard` retention to 1d and Dependabot open PRs to 3. |
| 2 | `Arcanea-Labs/arcanea-ai-app` | https://github.com/Arcanea-Labs/arcanea-ai-app/pull/776 | **MERGED** | Caps `retention-days: 1` across all 9 workflows calling `upload-artifact` (down from 7–30 days) to prevent account-wide 2 GB quota lockouts. |
| 2 | `frankxai/frankx.ai-vercel-website` | https://github.com/frankxai/frankx.ai-vercel-website/pull/1334 | **MERGED** | Caps `upload-artifact` retention to 1d (`ci.yml`, `estate-guard.yml`, `search-context-evidence.yml`) and switches `estate-guard.yml` & `web-excellence.yml` to `ubuntu-slim`. Protected surfaces untouched. |
| 3 | `frankxai/agentic-ops` | https://github.com/frankxai/agentic-ops/pull/666 | **MERGED** | Fixes `services/cf-checker` (`Starlight Review`) false-positive blocker on `ubuntu-slim` and `@v7`/`@v6` official action versions across both system prompts (`models.ts`, `review.ts`, `review.test.ts`); deployed live (`70e955d6-aa5c-4804-9108-2cc06d5e7a81`). |
| 3 | `Starlight-Intelligence/starlight-command-center` | https://github.com/Starlight-Intelligence/starlight-command-center/pull/156 | **MERGED** | Draft-gates heavy jobs across 5 workflows, moves `capability-registry.yml` & `electron-shell` to `ubuntu-slim`, caps all `upload-artifact` retention to 1d. |
| 3 | `Starlight-Intelligence/starlight-kernel` | https://github.com/Starlight-Intelligence/starlight-kernel/pull/40 | **MERGED** | Draft-gates all 3 CI jobs and moves Linux matrix leg & `release-readiness` to `ubuntu-slim`. |
| 3 | `Starlight-Intelligence/starlight-memory` | https://github.com/Starlight-Intelligence/starlight-memory/pull/64 | **MERGED** | Caps all 4 `upload-artifact` retention steps in `ci.yml` & `package-consumer.yml` from 7d to 1d. |
| 3 | `frankxai/agenticpassiveincome` | https://github.com/frankxai/agenticpassiveincome/pull/78 | **MERGED** | Moves lightweight workflows (`estate-guard`, `web-excellence`, `knowledge-freshness`, `draft-github-release`, `release-contract`) to `ubuntu-slim`, draft-gates non-required checks, caps retention to 1d. |
| 3 | `frankxai/gencreator-community` | https://github.com/frankxai/gencreator-community/pull/38 | **MERGED** | Draft-gates PR runs, moves `estate-guard` & `web-excellence` to `ubuntu-slim`, caps retention 30d -> 1d. |
| 3 | `frankxai/product-plans` | https://github.com/frankxai/product-plans/pull/90 | **MERGED** | Switches zero-dependency `kits` & `measured` jobs in `ci.yml` (and synced `docs/ci/product-plans-ci.yml`) to `ubuntu-slim` (`timeout-minutes: 10`), preserving draft runs. |
| 4 | `Starlight-Intelligence/starlight-agent-config` | https://github.com/Starlight-Intelligence/starlight-agent-config/pull/232 | **MERGED** | Moves lightweight Node/Python workflows & Linux matrix legs to `ubuntu-slim`, preserves `ubuntu-latest`/`windows-latest` where `pwsh`/Windows required, draft-gates Windows & non-required PR runs, caps retention 3d -> 1d. |
| 4 | `frankxai/starlight-estate` | https://github.com/frankxai/starlight-estate/pull/129 | **MERGED** | Moves `autonomy-lanes` & `character-registry-validate` to `ubuntu-slim` (`timeout-minutes: 10`), preserves `windows-latest` on `mcp-validate`, adds PR concurrency and draft gating. |
| 4 | `Arcanea-Labs/AnimeLegends` | https://github.com/Arcanea-Labs/AnimeLegends/pull/85 | **MERGED** | Switches fallback runners (`'ubuntu-latest'` -> `'ubuntu-slim'`) on lightweight validation/Python jobs, preserves `ubuntu-latest` for Next/Remotion builds, adds draft PR gating. |
| 4 | `frankxai/starlight-intelligence-academy` | https://github.com/frankxai/starlight-intelligence-academy/pull/112 | **MERGED** | Caps Playwright browser artifact retention 14d -> 1d in `ci.yml`, moves `curriculum.yml` & `visual-anchor-contract.yml` to `ubuntu-slim` with draft gating & PR concurrency. |
| 4 | `frankxai/llm-evals` | https://github.com/frankxai/llm-evals/pull/31 | **MERGED** | Gates `deterministic-verification.yml` (`windows-2022`) on ready PRs (`draft == false`), preserving pushes to `main`. |
| 4 | `frankxai/claude-code-config` | https://github.com/frankxai/claude-code-config/pull/70 | **MERGED** | Switches pure-Python `validate` job in `ci.yml` to `ubuntu-slim`. |
| 4 | `frankxai/frankx-strategy` | https://github.com/frankxai/frankx-strategy/pull/22 | **MERGED** | Switches `test` job in `ci.yml` to `ubuntu-slim` (`timeout-minutes: 10`), adds draft PR gating and PR-only `cancel-in-progress`. |
| 5 | `frankxai/agentic-ops` | https://github.com/frankxai/agentic-ops/pull/669 | **MERGED** | Pins `setup-python`/`setup-node` on `ubuntu-slim` jobs and restores `ubuntu-latest` for git-heavy chain test (`queen-chain-behavior.yml`). |
| 5 | `frankxai/frankx.ai-vercel-website` | https://github.com/frankxai/frankx.ai-vercel-website/pull/1347 | **MERGED** | Keeps `3`-day retention on `search-context-evidence.yml`. |
| 5 | `frankxai/gencreator-community` | https://github.com/frankxai/gencreator-community/pull/39 | **MERGED** | Switches Dependabot schedule from `weekly` -> `monthly` and caps `open-pull-requests-limit: 3` across `npm` & `github-actions`. |
| 5 | `frankxai/agentic-ops` | https://github.com/frankxai/agentic-ops/pull/670 | **MERGED** | Frontier `services/cf-checker` upgrade: grounds prompts in live passing CI checks (`Repo.ci().passing` -> `passed:` in `userPrompt()`) + 2026 CI cost hygiene; `219/219` tests pass; **deployed live** (`a07b7513-b6d9-4b96-83ec-bb5ce85d2992`). |

---

## 4. Frank's Remaining Manual Execution Checklist (Money / Secrets / Final Approval)

*Already executed automatically (2026-11-27): toggled **Copilot Automatic Code Review OFF** (`aria-pressed=false` verified after reload, saving ~$65/mo); merged **26 of 27** PRs across Waves 1–5; deployed frontier `starlight-cf-checker` (`a07b7513-b6d9-4b96-83ec-bb5ce85d2992`) and `starlight-ci-sentinel` (`05f61ff5-1a8d-4a2a-82d6-8fef3b381572`, `/health` HTTP `200`, `/audit` HTTP `503`); created R2 bucket `starlight-ci-cache` (`expire-7d`); purged **419.88 MB** of stale CI storage.*

1. **Apply Option A ("1+1" Billing = `$8/mo` base) in staged BrowserOS neo tab (`Starlight-Intelligence Billing`):**
   - Keep `frankxai` Pro (`$4/mo`) with **$20/mo Actions cap**.
   - Upgrade **only `Starlight-Intelligence` → Team (`$4/mo`)** with **$20/mo Actions cap** (restores private minutes + unlocks private branch protection). Keep the other 8 orgs on Free (`$0/mo`).
2. **Bind `workers/ci-sentinel` Secrets (then retire Hub cron watchers):**
   ```bash
   cd workers/ci-sentinel
   npx wrangler secret put SENTINEL_TOKEN
   npx wrangler secret put GH_ESTATE_TOKEN
   npx wrangler deploy
   ```
   - Once verified live with secrets, disable `fleet-watch.yml`, `estate-ci-watch.yml`, and `ci-budget-guard.yml` crons in `agentic-ops-hub`.
3. **Approve & Merge Final Open PR (`SIS#617`):**
   - Review/approve & merge `Starlight-Intelligence/Starlight-Intelligence-System#617` (`independent-review-policy` + 1 maintainer review).
   - **Hold / Do NOT merge `frankxai/agentic-ops#664` as-is:** It raises `DAILY_BUDGET_USD` from `$5` → `$100/day` right before Dec 1, 2026 when Cloudflare Workers AI leaves credit coverage! Keep `DAILY_BUDGET_USD="5"` + AI Gateway caching & rate-limiting active.

---

## 5. Independent Agent Review Checklist (Falsification Protocol)

1. **Math check:** Re-run `users/frankxai/settings/billing/usage` and `orgs/Starlight-Intelligence/settings/billing/usage` for `2026-11`; verify Option A (`$8/mo` base fixed, max `$48/mo` with caps) beats Option B (`$25/mo` base fixed) until combined org overage `>$17/mo` for 2 months.
2. **Model A boundary check:** Confirm no control-plane or Vercel-bound repo is slated for transfer, and `merge-steward` Environment secrets remain intact in `frankxai/agentic-ops-hub`.
3. **Workflow safety check:** Confirm zero `ubuntu-slim` jobs use Docker `services:`, `sudo apt-get`, or >15 min timeouts, and zero required checks (`agenticincome` `build`, `Dependency audit`, `scan`; `starlightintelligence.ai` `ci-contract`, `release-aggregate`) are skipped on drafts.
4. **Security check on `workers/ci-sentinel`:** Confirm `/audit` & `/run` fail closed (`503` unbound, constant-time `401` mismatch) and `/health` leaks zero secrets or billing data.
5. **Artifact safety check:** Confirm every `upload-artifact` change only reduces `retention-days` (no producer upload removed where a `download-artifact` exists).
6. **Cloudflare credit scope check:** Confirm Workers, Cron Triggers, Workers Builds, and R2 draw from the active Cloudflare for Startups credit balance on account `0b5c0d4435bdb220b9ed28efa0a98554`.
7. **Red-team check:** Monitor `starlightintelligence.ai` monthly private Actions usage after migrating `pr-gate` to `starlight-review` and previews to Workers Builds to confirm it stays inside `Starlight-Intelligence` Team's 3,000 included minutes.

---

## 6. Free-Cap & Ultra-Low-Cost Scaling Stack

| Lever | Free Tier / Credits | Current State | Highest-ROI Action |
| --- | --- | --- | --- |
| **Blacksmith.sh (`blacksmith-sh`)** | **GitHub Organizations ONLY (no personal `frankxai/*` accounts)** (`$4.87 − $4.87 = $0.00` verified on `Starlight-Intelligence`; `$0.00` on `Arcanea-Labs`) | Org apps connected; `Starlight-Intelligence/starlight-command-center` already sets `CI_RUNNER=blacksmith-2vcpu-ubuntu-2404`; `Arcanea-Labs` has `blacksmith-sh` `selected` (`arcanea-ai-app` is public `$0` Actions) | Keep `frankxai/*` personal repos on `ubuntu-latest`/`ubuntu-slim`/Railway (Blacksmith unsupported on personal accounts); use org Blacksmith free quota only on private org builds (`Starlight-Intelligence/*`, `Arcanea-Labs/AnimeLegends`) |
| **OCI Always Free Ampere A1 ARM** | **4 OCPU + 24 GB RAM + 200 GB storage + 10 TB egress/mo (`$0/mo` forever)** | Available on Frank's Oracle Cloud tenancy | Provision 1 ephemeral private-repo-only self-hosted runner VM for unlimited Linux CI/agent batch jobs outside GitHub quotas |
| **Cloudflare Startup Credits + Free Tiers** | **`$10,000.00` active** (expires Oct 30, 2027; `R2 · $2,500`, `PlanetScale · $2,500`, Workers/Builds/Containers covered; **EXCLUDES AI Gateway, and Workers AI leaves credit coverage Dec 1, 2026**) | `starlight-cf-checker` **v3.1+ live** (`510b9bf3-a073-46f1-865d-3d837ec2f336`); `starlight-ci-sentinel` **v0.2.0 live** (`b9874704-42ed-43b4-a465-f2366f603ae2`, `/health` `200`, `/sweep` `503`); `starlight-turbo-cache` **v0.1.0 live + `TURBO_CACHE_TOKEN` bound** (`bb959c9a-9236-4053-9bd4-7b9486c17464`, `GET /health` `200`, unauth `401`, auth `/status` `200 {"status":"enabled"}`); `starlight-ci-cache` R2 + `expire-7d` **live**; `starlight-review` AI Gateway has `Cache Responses`, `Rate Limit`, and `Spend Limits` **enabled** | **CRITICAL:** Keep `DAILY_BUDGET_USD="5"` on `starlight-cf-checker` (hold `#664` `$100/day`) so post-Dec 1 Workers AI traffic (`$84.88` / `95.9M` tokens in past 30d) stays strictly capped; shift Workers/MCP previews to Workers Builds |
| **GitHub Pro / Team Free Caps** | `frankxai` Pro: 3,000 Linux min + 2 GB storage; `Starlight-Intelligence` Team: 3,000 Linux min + 2 GB storage | **40/41 PRs merged** (26/27 Waves 1–5 + 5/5 Wave 6 + **9/9 Wave 7**; only `SIS#617` open); Copilot Auto Review **OFF** (`~$65/mo` saved); **419.88 MB** purged (`383` stale artifacts = `140.54 MB`, `24` closed-PR caches = `279.34 MB`) | Keep `ubuntu-slim` (`3x` cheaper) + `1d–3d` retention so private storage never hits 2 GB lockout again |
| **Dependabot Batching** | Fewer CI storms | `agenticincome#155` & `gencreator-community#39` **MERGED** (`monthly`, grouped, `limit: 3`) | Keep monthly + grouped (`limit: 3`) standard across any new repo |

---

## 7. Frontier Wave 6 Shipped (2026-11-27) & Phase 2 R&D Blueprint

### Measured 7-Day `starlight-review` D1 Baseline (Pre-v3 Cutoff Check)
- **7-day totals (before Wave 6 v3 deploy):** `265` model calls consuming `10.10M` prompt tokens (`~38,100` prompt tokens/call average; top consumers: `railway-ci-runners` `108.4k` avg, `starlight-estate` `71.8k`, `starlight-command-center` `56.2k`, `gencreator.ai` `47.6k`).
- **Model cost split:** `@cf/zai-org/glm-5.3` accounted for `$7.74` across `138` calls (`14.8s` avg latency, `83%` of spend), while `@cf/deepseek-ai/deepseek-v4.1-flash-1017` cost `$1.61` across `127` calls (`10.8s` avg latency, `98.4%` success).
- **Live v3 Impact Verified Immediately After Deploy:** `cf-checker` v3 hunk-windowed reviews cut prompt+completion tokens to **`6,662 + 6,746` on `gencreator.ai#378`** (down ~86% from `47.6k` avg prompt tokens) and **`5,184 + 4,649` on `frankx.ai-vercel-website#1348`** (down ~82% from `27.5k` avg prompt tokens).

### Wave 6 PRs Merged (5 / 5 Merged) & Live Worker Deployments

| Component / Repo | PR / Endpoint | State | Summary & Verified Live Proof |
| --- | --- | --- | --- |
| `frankxai/agentic-ops` (`services/cf-checker` v3) | https://github.com/frankxai/agentic-ops/pull/674 | **MERGED** (`4f93b4a2`) | Adds `changedHunkRanges`, `excerptFileContent` (hunk-scoped context windows keeping raw code verbatim for Layer C verification), `cheapestFirst` low-risk routing (`deepseek-v4.1-flash` first, escalating to `glm-5.3` only on failure/rejection/high findings), and `blacksmith-4vcpu-ubuntu-2404` 2026 platform facts. `tsc --noEmit` + `220/220` tests pass; **deployed live** (`starlight-cf-checker`, Version ID `3fe871d9-4695-4f06-89b2-77ae5514dab4`). |
| `Starlight-Intelligence/starlightintelligence.ai` (`workers/ci-sentinel` v0.2) | https://github.com/Starlight-Intelligence/starlightintelligence.ai/pull/410 | **MERGED** (`ddcf1ed1`) | Adds fail-closed `POST /sweep` + `sweepStaleStorage` protecting dynamic `default_branch`, `main`/`master`/`release/*`, paginated open-PR branches, recent (`<6h`) and unparseable caches, with `AUTO_SWEEP_STALE="false"` safe default (`72h` age threshold). `9/9` unit tests pass; **deployed live** (`starlight-ci-sentinel`, Version ID `b9874704-42ed-43b4-a465-f2366f603ae2`; `/health` HTTP `200`, `/sweep` HTTP `503`). |
| `Starlight-Intelligence/.github` (`reusable-ci.yml` v2) | https://github.com/Starlight-Intelligence/.github/pull/14 | **MERGED** (`e5c5ee52`) | Upgrades reusable workflow to `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`, `actions/cache@v5` (`pnpm`/`npm`), PR-only `cancel-in-progress`, and `runner: auto` (`blacksmith-4vcpu-ubuntu-2404` / `ubuntu-slim` / `ubuntu-latest`). |
| `frankxai/gencreator.ai` | https://github.com/frankxai/gencreator.ai/pull/378 | **MERGED** (`280416c8`) | Adds fail-closed `vars.CI_RUNNER == "blacksmith"` -> `blacksmith-4vcpu-ubuntu-2404` opt-in across `lint-typecheck`, `unit`, `build`, and `e2e` while keeping existing Railway and `ubuntu-latest` paths intact. Full CI + E2E green. |
| `frankxai/frankx.ai-vercel-website` | https://github.com/frankxai/frankx.ai-vercel-website/pull/1348 | **MERGED** (`b2eafd9b`) | Moves `dependency-audit` to `ubuntu-slim`, caches `~/.cache/puppeteer` (`actions/cache@v5` SHA-pinned) to eliminate repeated Chromium downloads, and adds fail-closed `vars.CI_RUNNER == "blacksmith"` opt-in on `ci`. All 13 CI/contract/Vercel checks green. |

### Frontier Phase 2 R&D Blueprint (Zero-Wasted-Spend Next Moves)
1. **Blacksmith 4-vCPU Cutover (GitHub Organizations Only — No Personal `frankxai/*` Support):**
   - `Starlight-Intelligence/starlight-command-center` already has `CI_RUNNER=blacksmith-2vcpu-ubuntu-2404` under `Starlight-Intelligence` (App installed on `all`); opt private org repos in once `Starlight-Intelligence` Team (`$4/mo`) unblocks Actions:
     ```bash
     gh variable set CI_RUNNER --body blacksmith -R Starlight-Intelligence/starlightintelligence.ai
     ```
   - Personal `frankxai/*` repos (`gencreator.ai`, `frankx.ai-vercel-website`, `agenticincome`) cannot use Blacksmith unless migrated to a GitHub Organization (`gencreator.ai` stays on `CI_RUNNER=railway` / GitHub-hosted; `frankx.ai-vercel-website` is public `$0`). `Arcanea-Labs/arcanea-ai-app` is public (`$0` unlimited GitHub Actions).
2. **Cloudflare R2 Turborepo Remote Cache (`starlight-ci-cache`, `$2,500` Credit Pool):**
   Place a tiny Cloudflare Worker (`TURBO_TOKEN` bearer auth) in front of the live `starlight-ci-cache` R2 bucket (`expire-7d` already active) and point Turborepo monorepos (`TURBO_API` + `TURBO_TEAM`) at it for cross-branch / cross-runner build caching with `$0` GitHub Actions cache quota.
3. **Cloudflare Workers Builds Offload:**
   Connect Worker repos/apps to native Cloudflare Workers Builds (`$10,000` credit pool) so static/Worker preview deployments never burn GitHub Linux minutes.
4. **OCI Always Free Ampere A1 ARM64 Runner (`4 OCPU / 24 GB RAM / 200 GB`):**
   Register one ephemeral `actions/runner` systemd service restricted to private control-plane repos (no fork PR execution) for heavy autonomous agent/eval suites outside GitHub minute caps.

---

## 8. Frontier Wave 7 Shipped (2026-11-27) & Overnight 8-Hour Autonomous Ops Protocol

### Wave 7 PRs Merged (9 / 9 Shipped)

| Repo | PR | Merge Commit | Merged At (UTC) | Summary |
| --- | --- | --- | --- | --- |
| `Starlight-Intelligence/starlightintelligence.ai` | https://github.com/Starlight-Intelligence/starlightintelligence.ai/pull/411 | `57ffe10d` | `2026-11-27T04:44:23Z` | Zero-dependency `workers/turbo-cache` Turborepo v8 R2 Remote Cache (`FixedLengthStream` PUTs, 50 MiB limit / 16 MiB chunked cap, SHA-256 constant-time auth, `ALLOWED_TEAMS` support, `5/5` tests). |
| `frankxai/agentic-ops` | https://github.com/frankxai/agentic-ops/pull/678 | `8f7d9b6e` | `2026-11-27T04:30:26Z` | `cf-checker` v3.1: tightens `isSupportPath` so only `*.test.*`/`*.spec.*` and data/media fixtures weigh 1/4 toward `maxLines`, while arbitrary `.ts`/`.js` files in `test/`/`fixtures/` count 100% weight. |
| `frankxai/agentic-ops` | https://github.com/frankxai/agentic-ops/pull/679 | `a765bd88` | `2026-11-27T04:40:43Z` | `cf-checker` flow-control 2b: an unproven lone objection passes with advisory notes instead of blocking clean PRs (`check`, `verify`, `Starlight Review` `SUCCESS`). |
| `frankxai/agenticincome` | https://github.com/frankxai/agenticincome/pull/157 | `17de0052` | `2026-11-27T04:45:07Z` | Adds `BLACKSMITH_RUNNER == 'true'` opt-in fallback (`blacksmith-2vcpu-ubuntu-2404`), scopes `cancel-in-progress` to `pull_request`, aligns `setup-node@v7`. |
| `frankxai/agenticincome` | https://github.com/frankxai/agenticincome/pull/149 | `72dce624` | `2026-11-27T04:35:37Z` | Adds read-only SHA-pinned `.github/workflows/frontier-surface-review.yml` (`build`, `Review Gate`, `Surface Guard`, `Vercel`, and Codex review all green). |
| `Arcanea-Labs/arcanea-ai-app` | https://github.com/Arcanea-Labs/arcanea-ai-app/pull/782 | `2f15bcd8` | `2026-11-27T11:57:08Z` | Adds gated `blacksmith-4vcpu-ubuntu-2404` opt-in, same-repo-guarded R2 Turbo cache env wiring on `typecheck` & `build`, and moves `CI Status` to `ubuntu-slim`. |
| `Starlight-Intelligence/starlight-command-center` | https://github.com/Starlight-Intelligence/starlight-command-center/pull/162 | `67375462` | `2026-11-27T04:41:36Z` | Upgrades Actions to `@v7`/`@v6`, scopes `cancel-in-progress` to PRs, and adds `blacksmith-4vcpu-ubuntu-2404` opt-in on `observatory` (`Starlight Review` dual `APPROVE`). |
| `frankxai/agentic-ops-hub` | https://github.com/frankxai/agentic-ops-hub/pull/531 | `a289cbe6` | `2026-11-27T04:28:32Z` | Updates `merge-steward/targets.yml` to `Arcanea-Labs/arcanea-ai-app` and `Starlight-Intelligence/starlightintelligence.ai` (`160/160` `test_merge_steward` green, dual `APPROVE`). |
| `Starlight-Intelligence/starlight-agent-config` | https://github.com/Starlight-Intelligence/starlight-agent-config/pull/228 | `18ebcfdc` | `2026-11-27T04:25:55Z` | Adds read-only MCP convergence audit CLI & unit tests (`5/5` tests pass locally, `MERGEABLE`/`CLEAN`). |

### Live 3-Worker Cloudflare Stack

| Worker | Endpoint | Live Version ID | Bindings | Verified Live Probes |
| --- | --- | --- | --- | --- |
| `starlight-cf-checker` | `https://starlight-cf-checker.frankxai.workers.dev` | `510b9bf3-a073-46f1-865d-3d837ec2f336` | KV `STATE`, Queue `starlight-review-jobs`, D1 `starlight-review`, Workers AI + AI Gateway `starlight-review` (`DAILY_BUDGET_USD="5"`) | `GET /health` -> HTTP `200` (`ok: true`, `reviews_by_status.done: 114`) |
| `starlight-ci-sentinel` | `https://starlight-ci-sentinel.frankxai.workers.dev` | `b9874704-42ed-43b4-a465-f2366f603ae2` | Cron Trigger `17 */6 * * *` (`SENTINEL_TOKEN` & `GH_ESTATE_TOKEN` unbound until bound) | `GET /health` -> HTTP `200`; `POST /sweep` -> HTTP `503` fail-closed |
| `starlight-turbo-cache` | `https://starlight-turbo-cache.frankxai.workers.dev` | `bb959c9a-9236-4053-9bd4-7b9486c17464` | R2 `CACHE_BUCKET` (`starlight-ci-cache`, `expire-7d`, `MAX_ARTIFACT_BYTES="52428800"`) + **`TURBO_CACHE_TOKEN` secret bound** | `GET /health` -> HTTP `200` (`storage: "r2"`); unauth `HEAD /v8/artifacts/...` -> HTTP `401`; auth `GET /v8/artifacts/status` -> HTTP `200 {"status":"enabled"}` |

### Verified Live R2 Cache & Runner Activation State (2026-11-27)

- **Activated end-to-end (`starlight-turbo-cache` + `Arcanea-Labs/arcanea-ai-app`):** `TURBO_CACHE_TOKEN` bound on Worker `starlight-turbo-cache`; `TURBO_TOKEN` secret and `TURBO_API=https://starlight-turbo-cache.frankxai.workers.dev`, `TURBO_TEAM=arcanea` variables set on `Arcanea-Labs/arcanea-ai-app`. `arcanea-ai-app` remains on `$0` unlimited public GitHub Actions runners with R2 remote caching active.
- **Blacksmith org scope enforced:** Left off personal `frankxai/*` repos (unsupported by Blacksmith on personal accounts); `Starlight-Intelligence/starlight-command-center` retains its existing `CI_RUNNER=blacksmith-2vcpu-ubuntu-2404` variable.
- **Remaining Frank-only actions (2 items):**
  1. Click **Upgrade to Team (`$4/mo`) + `$20/mo` Actions cap** on `Starlight-Intelligence` (money fails closed).
  2. *(Optional)* Create a narrow fine-grained PAT (`Actions: Read & Write` on target repos) and bind `SENTINEL_TOKEN` + `GH_ESTATE_TOKEN` on `starlight-ci-sentinel` to enable automated cache/artifact sweep.

### Overnight 8-Hour Autonomous Ops Protocol (Prepped for Unattended Execution)

1. **Cadence & Execution Lanes:** Run bounded 45-minute waves inside isolated worktrees (`git worktree` / fresh depth-1 clone); delete every `wt-ci-*` scratch checkout before closing a wave.
2. **PR Triage & Merge Gate (No `--admin` Bypass):**
   - Only merge ready (non-draft) `MERGEABLE` PRs after reading the diff, confirming every required CI/governance/Vercel check is green, and verifying `Starlight Review` / Codex receipts carry zero unresolved real bugs.
   - Held/deferred estate PRs requiring manual resolution or human approval:
     - **Money / Billing / Budgets:** `frankxai/agentic-ops#664`, `frankxai/starlight-estate#65`, `frankxai/frankx.ai-vercel-website#1320`, `frankxai/gencreator.ai#366` (money fails closed).
     - **Human Gates / Security / Doctrine / Intent Blockers:** `Starlight-Intelligence/starlight-command-center#144` (Frank human gate on auth/SQL), `Starlight-Intelligence/starlight-agent-config#227` (`SYSTEM-SPINE.md` doctrine), `frankxai/gencreator.ai#351` (`Vercel Security Review=FAILURE`), `#368` (blocked at Drain check intent), `#355` (honeypot/E2E bug finding), `frankxai/starlight-estate#128` (`GITHUB_TOKEN` leak finding), `frankxai/agenticincome#139` (`rm` scratch bypass finding).
     - **Conflicts / Real Build Failures / Review Bugs:** `frankxai/agentic-ops-hub#525`, `#496`, `#487` (`CONFLICTING/DIRTY`), `Starlight-Intelligence/starlight-agent-config#235` (`renderCard` bug finding), `Arcanea-Labs/arcanea-ai-app#781`, `#779`.
3. **Circuit Breakers & Cost Guardrails:**
   - Abort and hand back after **2 consecutive failures** on the same check or workflow.
   - Keep `starlight-cf-checker` `DAILY_BUDGET_USD="5"` (AI Gateway cache + rate-limit active before Dec 1 Workers AI billing change).
   - Keep `Starlight-Intelligence` private Actions workflows off heavy Linux legs until Frank upgrades only `Starlight-Intelligence` to Team (`$4/mo` + `$20/mo` cap).
   - Run `starlight-ci-sentinel` `POST /sweep` in dry-run/scheduled audit once `SENTINEL_TOKEN` + `GH_ESTATE_TOKEN` are bound to keep private Actions cache/artifact storage well below `2 GB`.
