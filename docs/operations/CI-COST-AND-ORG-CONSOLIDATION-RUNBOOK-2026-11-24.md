# CI Cost, Autonomous Agent Optimization & Org Consolidation Runbook (RFC v2)

**Measured:** 2026-11-24 / 2026-11-26 (GitHub Enhanced Billing Usage API `2026-11`, org APIs, branch-protection APIs, and Wrangler account `0b5c0d4435bdb220b9ed28efa0a98554`).

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
| `starlightintelligence.ai` | 8,106.0 | $52.87 | **$37.80** | Already in `Starlight-Intelligence` org (Model B) |
| `agentic-ops` | 3,212.0 | $12.17 | **$10.84** | **Model A — keep in `frankxai/`** |
| `agentic-ops-hub` | 1,209.4 | $7.15 | **$6.49** | **Model A — keep in `frankxai/`** |
| `agenticincome` | 1,063.1 | $6.38 | **$5.73** | **Model A — keep in `frankxai/`** (Vercel-bound) |
| `gencreator.ai` | 2,661.8 | $6.21 | **$5.66** | **Model A — keep in `frankxai/`** (Vercel-bound) |

### All 11 GitHub Namespaces (Seats, Repo Counts & Installed Apps)

| Namespace | Plan | Members (`filled_seats`) | Outside Collabs | Public / Private Repos | Nov Actions Gross / Net | Installed GitHub Apps (0 seats) |
| --- | --- | --- | --- | ---: | ---: | --- |
| `frankxai` | Pro | `frankxai` (1) | — | 189 / 196 | $216.19 / **$77.19** | *(user account)* |
| `Starlight-Intelligence` | Free | `frankxai` (1) | `[]` | 19 / 25 | $40.21 / $0.00 *(6,300.9 qty Nov 1–26)* | `blacksmith-sh`, `claude`, `google-labs-jules`, `chatgpt-codex-connector`, `starlight-review`, `vercel`, `antigravity-for-github` |
| `Arcanea-Labs` | Free | `frankxai` (1) | `[]` | 15 / 7 | $24.77 / $0.00 | `graphite-app`, `chatgpt-codex-connector`, `google-labs-jules`, `cursor`, `notion-ai-connector`, `claude`, `blacksmith-sh`, `starlight-review`, `antigravity-for-github` |
| `FrankX-AI` | Free | `frankxai` (1) | `[]` | 10 / 4 | $1.90 / $0.00 | `graphite-app`, `neon-postgres`, `supabase`, `blacksmith-sh`, `google-labs-jules`, `chatgpt-codex-connector`, `claude` |
| `AI-Architect-Academy` | Free | `frankxai` (1) | `[]` | 1 / 4 | $0.14 / $0.00 | `chatgpt-codex-connector`, `vercel`, `claude`, `blacksmith-sh`, `google-labs-jules` |
| `GenCreator-ai` | Free | `frankxai` (1) | `[]` | 8 / 3 | $0.09 / $0.00 | `claude`, `google-labs-jules`, `chatgpt-codex-connector` |
| `Starlight-Intelligence-Systems` | Free | `frankxai` (1) | `[]` | 6 / 2 | $0.10 / $0.00 | `google-labs-jules`, `chatgpt-codex-connector` |
| `Life-Commons` | Free | `frankxai` (1) | `[]` | 9 / 2 | $0.29 / $0.00 | `claude`, `blacksmith-sh`, `google-labs-jules`, `chatgpt-codex-connector` |
| `AI-Architect-Studio` | Free | `frankxai` (1) | `[]` | 11 / 1 | $0.16 / $0.00 | `claude`, `blacksmith-sh`, `google-labs-jules`, `chatgpt-codex-connector` |
| `Agentic-Income` | Free | `frankxai` (1) | `[]` | 12 / 2 | $0.68 / $0.00 | `claude`, `blacksmith-sh`, `google-labs-jules`, `chatgpt-codex-connector`, `cursor` |
| `oci-ai-architects` | Free | `frankxai` (1) | `[]` | 13 / 1 | $0.00 / $0.00 | `claude`, `blacksmith-sh` |

**Live Quota Lockout & Blocker Root Causes (2026-11-25 / 2026-11-26):**
- `Starlight-Intelligence` logged **2,068.8 private Actions minutes** in Nov (`starlightintelligence.ai` 802, `starlight-command-center` 770, `starlight-kernel` 249, `starlight-agent-config` 186.8, others 61; `6,300.9` total billing qty / `$40.21` gross as of Nov 26). On `Starlight-Intelligence/starlightintelligence.ai#396`, `Starlight CI / aggregate contract tests` and `release-aggregate` failed immediately with empty `runner_name` because `Starlight-Intelligence` (Free tier: 2,000 min/mo) hit its hard spending cap (`$0`), and private branch protection returns `HTTP 403`.
- **Wave 3 Blocker Discovery (`services/cf-checker`):** `Starlight Review` (`frankxai/agentic-ops/services/cf-checker`, Workers AI `glm-5.3` + `deepseek-v4.1-flash`) had 2024/2025 training cutoff knowledge and emitted false-positive blockers on `ubuntu-slim` across `#659`, `#524`, and `#375`. Fixed in `frankxai/agentic-ops#666` by teaching both review system prompts (`structuredSystemPrompt` & `systemPrompt`) that `ubuntu-slim` and `@v7`/`@v6` official action versions are valid (217/217 tests passing).
- **Vercel Commit Author Gate:** Vercel blocked deployment on `gencreator.ai#375` where commit `926175d` used an unlinked author email instead of verified `132689939+frankxai@users.noreply.github.com` (subsequent commits must pass `-c user.email="132689939+frankxai@users.noreply.github.com"`).

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

### Ruling 2 — Option A ("1+1" Billing = $8/mo Fixed) Before Option B (Enterprise Cloud)
- **Execute Option A now ($8/mo fixed total):**
  - Keep **`frankxai` Pro ($4/mo)** with a **$20/mo Actions spending cap** (covers Model A control plane + Vercel-bound repos after Copilot & `ubuntu-slim` cuts).
  - Upgrade **only `Starlight-Intelligence` to Team ($4/mo)** with a **$20/mo Actions spending cap** (unlocks 3,000 included min, unblocks `starlightintelligence.ai` runner allocation immediately, and unlocks private branch protection/rulesets).
  - Leave all **other 8 active orgs on Free ($0/mo, $0 cap)** — 0 billing setup needed.
- **Objective trigger to upgrade to Option B (1-seat GitHub Enterprise Cloud, $21/mo = 50,000 pooled org min + 50 GB storage):**
  - Upgrade *only if* combined monthly private Actions overages across orgs exceed **$17/mo for two consecutive months** (breakeven: $4 Team + $17 overage = $21 Enterprise) OR 3+ orgs simultaneously require private branch protection. Verify self-serve 1-seat metered checkout terms before switching.

---

## 3. All 16 PRs Shipped (Waves 1–3, 2026-11-24 – 2026-11-26)

| Wave | Repository | PR | State | Summary & Verification |
| --- | --- | --- | --- | --- |
| 1 | `Starlight-Intelligence/starlightintelligence.ai` | https://github.com/Starlight-Intelligence/starlightintelligence.ai/pull/396 | Draft | Adds zero-dependency `workers/ci-sentinel` Cloudflare Worker (`17 */6 * * *` cron + `/health`, `/audit`, `/run`), `CLOUDFLARE-CI-CUTOVER.md` guide, switches `ci-contract` & `release-aggregate` to `ubuntu-slim`, caps retention to 1–3d. (`ci-aggregate.test.mjs` 54/54, `ci-sentinel` 6/6, `wrangler deploy --dry-run` pass.) |
| 1 | `frankxai/agentic-ops` | https://github.com/frankxai/agentic-ops/pull/659 | Ready | Moves 7 lightweight workflows/legs to `ubuntu-slim`, draft-gates `customer-intelligence`, trims retention to 3d. `claude-code-review.yml` untouched. (`scripts/tests` + `multi-machine/tests` 21/21 pass; hosted checks green except pre-fix `Starlight Review`.) |
| 1 | `frankxai/agentic-ops-hub` | https://github.com/frankxai/agentic-ops-hub/pull/524 | Ready | Moves `ci`, `estate-guard`, `fleet-watch`, `estate-ci-watch` to `ubuntu-slim`, draft-gates `estate-guard`, halves `fleet-watch` cron (`*/6` -> `*/12`), cuts retention to 1–3d. (`handover` 20/20, `ci_budget` 71/71, `plan_limits` 16/16 via `uv --with tzdata`, remaining unit tests pass; pre-existing `sync-agent-rules` drift on `main` untouched.) |
| 1 | `frankxai/gencreator.ai` | https://github.com/frankxai/gencreator.ai/pull/375 | Ready | Enables PR-only `cancel-in-progress` on `ci.yml`, moves `web-excellence` & `estate-guard` to `ubuntu-slim`, removes duplicate PR `estate-guard`, caps retention to 1d. Locked surfaces untouched. (`ci-results.test.mjs` 34/34 pass.) |
| 1 | `Starlight-Intelligence/.github` | https://github.com/Starlight-Intelligence/.github/pull/13 | **MERGED** | Defaults org-wide `reusable-ci.yml` to `ubuntu-slim` with configurable `runner`, `timeout-minutes`, and `run-build`. (YAML OK.) |
| 1 | `Starlight-Intelligence/Starlight-Intelligence-System` | https://github.com/Starlight-Intelligence/Starlight-Intelligence-System/pull/617 | Draft | This RFC v2 Runbook (zero substrate files modified). |
| 2 | `frankxai/agenticincome` | https://github.com/frankxai/agenticincome/pull/155 | **MERGED** | Switches `dependency-audit`, `estate-guard`, `web-excellence`, `knowledge-freshness`, `org-mirror` to `ubuntu-slim`; draft-gates `web-excellence`; caps `estate-guard` retention to 1d and Dependabot open PRs to 3. Required checks preserved; locked surfaces untouched. (YAML OK.) |
| 2 | `Arcanea-Labs/arcanea-ai-app` | https://github.com/Arcanea-Labs/arcanea-ai-app/pull/776 | Draft | Caps `retention-days: 1` across all 9 workflows calling `upload-artifact` (down from 7–30 days) to prevent account-wide 2 GB quota lockouts. (YAML OK; note Actions is currently disabled on repo.) |
| 2 | `frankxai/frankx.ai-vercel-website` | https://github.com/frankxai/frankx.ai-vercel-website/pull/1334 | Draft | Caps `upload-artifact` retention to 1d (`ci.yml`, `estate-guard.yml`, `search-context-evidence.yml`) and switches `estate-guard.yml` & `web-excellence.yml` to `ubuntu-slim`. Protected surfaces untouched. (YAML OK.) |
| 3 | `frankxai/agentic-ops` | https://github.com/frankxai/agentic-ops/pull/666 | Draft | Fixes `services/cf-checker` (`Starlight Review`) false-positive blocker on `ubuntu-slim` and `@v7`/`@v6` official action versions across both system prompts (`models.ts`, `review.ts`, `review.test.ts`). (`pnpm check` + 217/217 tests + `wrangler deploy --dry-run` pass.) |
| 3 | `Starlight-Intelligence/starlight-command-center` | https://github.com/Starlight-Intelligence/starlight-command-center/pull/156 | Draft | Draft-gates heavy jobs across 5 workflows, moves `capability-registry.yml` & `electron-shell` to `ubuntu-slim`, caps all `upload-artifact` retention to 1d. (YAML OK.) |
| 3 | `Starlight-Intelligence/starlight-kernel` | https://github.com/Starlight-Intelligence/starlight-kernel/pull/40 | Draft | Draft-gates all 3 CI jobs and moves Linux matrix leg & `release-readiness` to `ubuntu-slim`. (YAML OK.) |
| 3 | `Starlight-Intelligence/starlight-memory` | https://github.com/Starlight-Intelligence/starlight-memory/pull/64 | Draft | Caps all 4 `upload-artifact` retention steps in `ci.yml` & `package-consumer.yml` from 7d to 1d. (YAML OK.) |
| 3 | `frankxai/agenticpassiveincome` | https://github.com/frankxai/agenticpassiveincome/pull/78 | Draft | Moves lightweight workflows (`estate-guard`, `web-excellence`, `knowledge-freshness`, `draft-github-release`, `release-contract`) to `ubuntu-slim`, draft-gates non-required checks, caps retention to 1d. (YAML OK.) |
| 3 | `frankxai/gencreator-community` | https://github.com/frankxai/gencreator-community/pull/38 | Draft | Draft-gates PR runs, moves `estate-guard` & `web-excellence` to `ubuntu-slim`, caps retention 30d -> 1d. (YAML OK.) |
| 3 | `frankxai/product-plans` | https://github.com/frankxai/product-plans/pull/90 | Draft | Switches zero-dependency `kits` & `measured` jobs in `ci.yml` to `ubuntu-slim` (`timeout-minutes: 10`), preserving draft runs. (YAML OK.) |

---

## 4. Frank's 4-Step Manual Execution Checklist (Money / UI / Deploy)

1. **Turn off Copilot Auto Code Review (saves ~$65/mo immediately):**
   - **GitHub → Settings → Copilot → Code review → Off** (keep manual `@copilot review` only).
2. **Apply Option A ("1+1" Billing = $8/mo fixed):**
   - Keep `frankxai` Pro ($4/mo) with **$20/mo Actions cap**.
   - Upgrade **only `Starlight-Intelligence` → Team ($4/mo)** with **$20/mo Actions cap** (immediately unblocks `starlightintelligence.ai#396`, `starlight-command-center#156`, `starlight-kernel#40`, `starlight-memory#64`, and enables private branch protection).
   - Keep the other 8 orgs on Free ($0/mo).
3. **Merge & Deploy `Starlight Review` (`#666`) + Cloudflare Cutover First:**
   - Merge `frankxai/agentic-ops#666`, then deploy the fixed reviewer Worker:
     ```bash
     cd C:\Users\frank\agentic-ops\services\cf-checker
     pnpm deploy
     ```
   - Deploy `workers/ci-sentinel` & shared R2 CI cache from `Starlight-Intelligence/starlightintelligence.ai#396` (account `0b5c0d4435bdb220b9ed28efa0a98554`, see `workers/ci-sentinel/docs/CLOUDFLARE-CI-CUTOVER.md`):
     ```bash
     cd workers/ci-sentinel
     npx wrangler secret put SENTINEL_TOKEN
     npx wrangler secret put GH_ESTATE_TOKEN
     npx wrangler deploy

     # Shared 7-day R2 CI cache/artifact bucket:
     npx wrangler r2 bucket create starlight-ci-cache
     npx wrangler r2 bucket lifecycle add starlight-ci-cache "expire-7d" --expire-days 7 --prefix ""
     ```
   - Install `starlight-review` (`services/cf-checker`) App on `frankxai` and the remaining 8 orgs.
   - Connect `workers/agents`, `workers/mcp`, and preview builds to **Cloudflare Workers Builds** (6,000 build min/mo @ 4 vCPU, Startup Credits).
   - Once `starlight-ci-sentinel` cron is verified live, disable `fleet-watch.yml`, `estate-ci-watch.yml`, and `ci-budget-guard.yml` crons in `agentic-ops-hub`.
4. **Merge Remaining Open Wave 1–3 PRs (`agentic-ops#659`, `agentic-ops-hub#524`, `gencreator.ai#375`, `arcanea-ai-app#776`, `frankx.ai-vercel-website#1334`, `starlight-command-center#156`, `starlight-kernel#40`, `starlight-memory#64`, `agenticpassiveincome#78`, `gencreator-community#38`, `product-plans#90`, `SIS#617`, `starlightintelligence.ai#396`):**
   - Already merged: `Starlight-Intelligence/.github#13`, `frankxai/agenticincome#155`.

---

## 5. Independent Agent Review Checklist (Falsification Protocol)

1. **Math check:** Re-run `users/frankxai/settings/billing/usage` and `orgs/Starlight-Intelligence/settings/billing/usage` for `2026-11`; verify Option A ($8/mo fixed) beats Option B ($25/mo fixed) until combined org overage >$17/mo for 2 months.
2. **Model A boundary check:** Confirm no control-plane or Vercel-bound repo is slated for transfer, and `merge-steward` Environment secrets remain intact in `frankxai/agentic-ops-hub`.
3. **Workflow safety check:** Confirm zero `ubuntu-slim` jobs use Docker `services:`, `sudo apt-get`, or >15 min timeouts, and zero required checks (`agenticincome` `build`, `Dependency audit`, `scan`; `starlightintelligence.ai` `ci-contract`, `release-aggregate`) are skipped on drafts.
4. **Security check on `workers/ci-sentinel`:** Confirm `/audit` & `/run` fail closed (`503` unbound, constant-time `401` mismatch) and `/health` leaks zero secrets or billing data.
5. **Artifact safety check:** Confirm every `upload-artifact` change only reduces `retention-days` (no producer upload removed where a `download-artifact` exists).
6. **Cloudflare credit scope check:** Confirm Workers, Cron Triggers, Workers Builds, and R2 draw from the active Cloudflare for Startups credit balance on account `0b5c0d4435bdb220b9ed28efa0a98554`.
7. **Red-team check:** Monitor `starlightintelligence.ai` monthly private Actions usage after migrating `pr-gate` to `starlight-review` and previews to Workers Builds to confirm it stays inside `Starlight-Intelligence` Team's 3,000 included minutes.
