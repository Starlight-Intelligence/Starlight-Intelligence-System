# CI Cost, Autonomous Agent Optimization & Org Consolidation Runbook

**Measured:** 2026-11-24 (GitHub Enhanced Billing Usage API `2026-11`, org APIs, and Wrangler account `0b5c0d4435bdb220b9ed28efa0a98554`).

---

## 1. Verified Live Baseline (Nov 1–24, 2026)

### Account Spend (`frankxai` Pro)

| Product | Quantity | Gross | Net Billed |
| --- | ---: | ---: | ---: |
| GitHub Actions | 40,386.3 | $216.19 | **$77.19** |
| Copilot AI credits (auto PR reviews) | 26,500.0 | $265.00 | **$65.00** *(cap hit)* |
| **Total (24 days)** | — | **$481.19** | **$142.19** |

### Actions SKU Breakdown (`frankxai`)

| SKU | Quantity | Gross | Net Billed |
| --- | ---: | ---: | ---: |
| Actions Linux | 30,330.0 | $181.98 | $61.75 |
| Actions macOS 3-core | 233.0 | $14.45 | $6.37 |
| Actions Linux Slim | 2,676.0 | $5.35 | $5.13 |
| Actions Windows | 1,243.0 | $12.43 | $3.30 |
| Actions storage | 5,904.3 | $1.98 | $0.64 |

### Top 5 Billed Private Repos (86.2% of Actions Bill)

| Repository | Qty | Gross | Net Billed |
| --- | ---: | ---: | ---: |
| `starlightintelligence.ai` | 8,106.0 | $52.87 | **$37.80** |
| `agentic-ops` | 3,212.0 | $12.17 | **$10.84** |
| `agentic-ops-hub` | 1,209.4 | $7.15 | **$6.49** |
| `agenticincome` | 1,063.1 | $6.38 | **$5.73** |
| `gencreator.ai` | 2,661.8 | $6.21 | **$5.66** |

### All 11 GitHub Namespaces (Seats, Repo Counts & Installed Apps)

| Namespace | Plan | Members (`filled_seats`) | Outside Collabs | Public / Private Repos | Nov Actions Gross / Net | Installed GitHub Apps (0 seats) |
| --- | --- | --- | --- | ---: | ---: | --- |
| `frankxai` | Pro | `frankxai` (1) | — | 189 / 196 | $216.19 / **$77.19** | *(user account)* |
| `Starlight-Intelligence` | Free | `frankxai` (1) | `[]` | 19 / 25 | $35.50 / $0.00 | `blacksmith-sh`, `claude`, `google-labs-jules`, `chatgpt-codex-connector`, `starlight-review`, `vercel`, `antigravity-for-github` |
| `Arcanea-Labs` | Free | `frankxai` (1) | `[]` | 15 / 7 | $24.77 / $0.00 | `graphite-app`, `chatgpt-codex-connector`, `google-labs-jules`, `cursor`, `notion-ai-connector`, `claude`, `blacksmith-sh`, `starlight-review`, `antigravity-for-github` |
| `FrankX-AI` | Free | `frankxai` (1) | `[]` | 10 / 4 | $1.90 / $0.00 | `graphite-app`, `neon-postgres`, `supabase`, `blacksmith-sh`, `google-labs-jules`, `chatgpt-codex-connector`, `claude` |
| `AI-Architect-Academy` | Free | `frankxai` (1) | `[]` | 1 / 4 | $0.14 / $0.00 | `chatgpt-codex-connector`, `vercel`, `claude`, `blacksmith-sh`, `google-labs-jules` |
| `GenCreator-ai` | Free | `frankxai` (1) | `[]` | 8 / 3 | $0.09 / $0.00 | `claude`, `google-labs-jules`, `chatgpt-codex-connector` |
| `Starlight-Intelligence-Systems` | Free | `frankxai` (1) | `[]` | 6 / 2 | $0.10 / $0.00 | `google-labs-jules`, `chatgpt-codex-connector` |
| `Life-Commons` | Free | `frankxai` (1) | `[]` | 9 / 2 | $0.29 / $0.00 | `claude`, `blacksmith-sh`, `google-labs-jules`, `chatgpt-codex-connector` |
| `AI-Architect-Studio` | Free | `frankxai` (1) | `[]` | 11 / 1 | $0.16 / $0.00 | `claude`, `blacksmith-sh`, `google-labs-jules`, `chatgpt-codex-connector` |
| `Agentic-Income` | Free | `frankxai` (1) | `[]` | 12 / 2 | $0.68 / $0.00 | `claude`, `blacksmith-sh`, `google-labs-jules`, `chatgpt-codex-connector`, `cursor` |
| `oci-ai-architects` | Free | `frankxai` (1) | `[]` | 13 / 1 | $0.00 / $0.00 | `claude`, `blacksmith-sh` |

---

## 2. Draft PRs Shipped Today (2026-11-24)

| Repository | Draft PR | Key Changes & Impact |
| --- | --- | --- |
| `Starlight-Intelligence/starlightintelligence.ai` | https://github.com/Starlight-Intelligence/starlightintelligence.ai/pull/396 | Adds zero-dependency `workers/ci-sentinel` Cloudflare Worker (`17 */6 * * *` cron + `/health`, `/audit`, `/run` reporting to one durable issue at $0 GitHub Actions cost), switches `ci-contract` & `release-aggregate` to `ubuntu-slim`, caps artifact retention to 1–3 days. |
| `frankxai/agentic-ops` | https://github.com/frankxai/agentic-ops/pull/659 | Moves 7 lightweight workflows/legs (`cf-checker-ci`, `queen-work-contract`, `queen-chain-behavior`, `swarm-bus-behavior`, `production-reliability`, `customer-intelligence`, `media-platform-ci`) to `ubuntu-slim` (3x cheaper), draft-gates `customer-intelligence`, trims artifact retention to 3 days. |
| `frankxai/agentic-ops-hub` | https://github.com/frankxai/agentic-ops-hub/pull/524 | Moves `ci`, `estate-guard`, `fleet-watch`, `estate-ci-watch` to `ubuntu-slim`, draft-gates `estate-guard`, halves `fleet-watch` cron (`*/6` -> `*/12`), cuts artifact retention to 1–3 days. |
| `frankxai/gencreator.ai` | https://github.com/frankxai/gencreator.ai/pull/375 | Enables PR-only `cancel-in-progress` on `ci.yml`, moves `web-excellence` & `estate-guard` to `ubuntu-slim`, removes duplicate `pull_request` trigger on `estate-guard` (`ci.yml` already runs it), trims artifact retention to 1 day. Locked governance surfaces untouched. |
| `Starlight-Intelligence/.github` | https://github.com/Starlight-Intelligence/.github/pull/13 | Upgrades org-wide `reusable-ci.yml` default runner to `ubuntu-slim` with configurable `runner`, `timeout-minutes`, and `run-build` wiring. |

---

## 3. Frank's 5-Minute Manual Execution Checklist (Money / UI / Deploy)

> Agents cannot touch billing, Copilot UI toggles, repo transfers, repo visibility, or live production deploys without explicit operator action.

### Step A — Disable Automatic Copilot PR Reviews (UI, saves ~$65/mo immediately)
1. Open **GitHub → Settings → Copilot → Code review**.
2. Turn **Automatic code review** **Off** (or disable *Review new pushes* and *Review draft PRs*). Keep manual `@copilot review` only when explicitly wanted.

### Step B — Activate 1-Seat GitHub Enterprise Cloud ($21/mo unified billing + 50,000 pooled Actions min)
Every one of your 10 orgs currently has **`filled_seats: 1` (`frankxai`)** and **0 outside collaborators**. All installed tools are GitHub Apps (0 seats).
1. Create a **GitHub Enterprise Cloud** account billed to 1 seat ($21/mo) and attach your active orgs under it.
2. Result: **1 invoice, 1 payment method, 1 global Actions spending cap, 50,000 pooled Actions minutes/month ($300/mo compute credit), and 50 GB storage** across every attached org — including every new org you create in the future.

### Step C — Move Top Billed Personal Private Repos into Orgs (Enter the 50k Pool)
Personal `frankxai` repos do **not** share the Enterprise 50,000-minute pool; org repos do.
Transfer these 4 private repos from `frankxai` (via **Repo Settings → General → Danger Zone → Transfer**):
- `frankxai/agentic-ops` → `Starlight-Intelligence`
- `frankxai/agentic-ops-hub` → `Starlight-Intelligence`
- `frankxai/gencreator.ai` → `GenCreator-ai`
- `frankxai/agenticincome` → `Agentic-Income`

Also decide explicitly on `Starlight-Intelligence/starlightintelligence.ai` visibility (public = unlimited $0 CI; private = covered by the 50k Enterprise pool once attached).

### Step D — Deploy `starlight-ci-sentinel` to Cloudflare (Startup Credits)
Account verified via `wrangler whoami`: `0b5c0d4435bdb220b9ed28efa0a98554`.
After merging `starlightintelligence.ai` PR #396:

```bash
cd workers/ci-sentinel
npx wrangler secret put SENTINEL_TOKEN
npx wrangler secret put GH_ESTATE_TOKEN
npx wrangler deploy
```

- `SENTINEL_TOKEN`: generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
- `GH_ESTATE_TOKEN`: fine-grained PAT (or App token) with read access to org/user Actions & billing + `issues:write` on `frankxai/agentic-ops-hub`.
- Once verified live on cron, disable or remove `fleet-watch.yml`, `estate-ci-watch.yml`, and `ci-budget-guard.yml` crons in GitHub Actions.
- Also install the existing `starlight-review` (`services/cf-checker`) GitHub App on your other 8 orgs (currently only on `Starlight-Intelligence` and `Arcanea-Labs`) to replace runner-based review gates (`Review Gate`, `pr-gate`).

### Step E — Cloudflare Workers Builds & R2 Remote Cache
1. Connect Worker/Pages/OpenNext projects to **Cloudflare Workers Builds** (Paid plan: 6,000 build min/mo included, 4 vCPU / 8 GB RAM / 20 GB disk, drawn from Startup Credits) instead of running `wrangler deploy` in GitHub Actions PR previews.
2. Create an R2 bucket (e.g. `starlight-ci-cache`) with a 7-day lifecycle expiration rule for Turborepo/build artifacts and Playwright screenshots so GitHub's artifact quota is never hit again.

### Step F — Org Consolidation Candidates (Operator Decision)
- `Starlight-Intelligence-Systems` (2 private, 6 public) vs `Starlight-Intelligence` (25 private, 19 public): consider consolidating to eliminate duplicate branding/admin.
- `AI-Architect-Studio` (1 private, 11 public) vs `AI-Architect-Academy` (4 private, 1 public): consider whether both orgs are needed.

---

## 4. Autonomous Agent CI Operating Rules ("Checks Only Where Needed")
1. **Always open Draft PRs first.** Agents iterate locally (`scripts/local_verify.py` / `pnpm test`) at $0 before marking Ready for Review.
2. **One consolidated Tier-1 job per repo** (1 checkout, 1 install, sequential checks on `ubuntu-slim` where no Docker/service containers are needed).
3. **Never trigger Actions runners on `issue_comment` or `pull_request_review`.** Route comment/review/policy checks through Cloudflare Workers (`starlight-review` / `starlight-ci-sentinel`).
4. **Never run `macos-latest` (10x) or `windows-latest` (1.7x) on PRs** unless platform-native compilation is strictly required for merge — keep desktop bundles on `push: main` / release tags.
5. **Artifact retention max 1–3 days** (`retention-days: 1` on PR artifacts).
