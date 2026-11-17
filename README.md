<p align="center"><img src=".github/assets/hero.svg" width="100%" alt="Starlight Intelligence System: local memory, defined agents, human review" /></p>

# Starlight Intelligence System

**Give your AI agents a shared memory. Keep the keys.**

Carry decisions and context between your tools with local memory vaults, MCP, agent definitions, and an open protocol. Inspect the source, choose the pieces you need, and build a system around your own work.

[Explore the system](https://starlightintelligence.org/#system-tour) · [Local setup](#60-second-start) · [Read SIP](SIP.md) · [Contribute](CONTRIBUTING.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-c4b5fd?style=flat-square&labelColor=0d1117)](LICENSE)
[![SIP](https://img.shields.io/badge/SIP-v1.1.1-67e8f9?style=flat-square&labelColor=0d1117)](SIP.md)

## Choose your first result

| What you want to do | Start here | What to expect |
| --- | --- | --- |
| Carry context between AI tools | [Local setup](#60-second-start) | Node 22 or 24; build the source and configure your MCP client |
| Understand how the pieces connect | [Interactive architecture](https://starlightintelligence.org/#system-tour) | Illustrated memory, agent, and review layers with source links |
| Host your own public interface | [Deploy Starlight Explorer](#deploy-starlight-explorer) | Read-only website; hosting costs may apply |
| Adopt the shared contract | [Protocol specification](SIP.md) | MIT-licensed files and conventions; no hosted account required |

## What lives here

**SIP is the contract. SIS is the reference implementation.** The protocol describes composition, attribution, and decision rights. The implementation supplies memory, adapters, agent definitions, and tooling. A definition describes an agent; it does not establish that an agent is running.

| Layer | Inspect it | Why it matters |
| --- | --- | --- |
| Memory | [Vault implementation](src/vault-memory.ts) · [Memory guide](memory/README.md) | Preserve useful context outside a chat session |
| Agents and skills | [Agent registry](agents/AGENT_REGISTRY.md) · [Skill registry](skills/SKILL_REGISTRY.md) | Make responsibilities and reusable instructions inspectable |
| Review and attribution | [SIP](SIP.md) · [Verification surface](https://starlightintelligence.org/verify) | Separate declared attribution from evidence you can check |

You configure clients and permissions. Model providers, external services, and hosting have their own requirements and costs. Public Explorer deployment does not launch your private runtime. See [setup](SETUP.md) and the [source-counted metrics ledger](metrics/current.json) for the current implementation boundaries.

## Deploy Starlight Explorer

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FStarlight-Intelligence%2FStarlight-Intelligence-System&root-directory=site&project-name=starlight-explorer&repository-name=starlight-explorer)

Create a Git-connected copy of the [`site/`](site/) Next.js application: protocol, architecture, research, knowledge maps, and read-only public vault surfaces. Zero required environment variables for the default public Explorer.

**What remains local:** private memory, MCP servers, agent workers, credentials, and orchestration. [Review the deployment boundary](https://starlightintelligence.org/deploy) before you deploy.

## Build with us

[Report a reproducible issue](https://github.com/Starlight-Intelligence/Starlight-Intelligence-System/issues/new/choose) · [Contribution guide](CONTRIBUTING.md) · [Project and founder](https://starlightintelligence.ai/about)

Canonical repository: **Starlight-Intelligence/Starlight-Intelligence-System**. Open issues and pull requests here. Led by Frank Riemer in Amsterdam.

<a id="60-second-start"></a>

## Local setup

```bash
git clone https://github.com/Starlight-Intelligence/Starlight-Intelligence-System
cd Starlight-Intelligence-System && npm install && npm run build
node dist/cli.js init --vaults
```

> npm serves `@arcanea/starlight-intelligence-system@8.5.1` as checked on 10 October 2026. This checkout uses Node 22 or 24. The modular packages are release candidates; the operational SDK keeps its own contracts and sanitizer until a separately versioned root migration is published.

Then add to your MCP config (Claude Code, Cursor, Codex, Gemini, etc.), pointing at the `dist/mcp-server.js` inside your clone:

```json
{
  "mcpServers": {
    "starlight": {
      "command": "node",
      "args": ["/path/to/Starlight-Intelligence-System/dist/mcp-server.js", "--vault-dir", "~/.starlight/vaults"]
    }
  }
}
```

(If you installed via npm instead, the path is `node_modules/@arcanea/starlight-intelligence-system/dist/mcp-server.js` — but see the version note above.)

Restart your client and confirm that the server connects. Clients configured to use this server can access the vaults you selected. Client configuration formats vary; use [SETUP.md](SETUP.md) for your environment.

---


<details>
<summary><strong>Specialist tools and extended reference</strong></summary>

## Foundry: portable capabilities for ChatGPT and Codex

Starlight Foundry turns intent into a typed Task Envelope, resolves existing capabilities, compiles the smallest justified skill or agent system, and issues an evidence receipt before promotion.

```text
/forge skill <brief>
/forge agent <brief>
/forge swarm <brief>
/forge vertical <brief>
/forge plugin <brief>
/prove <package-or-artifact>
/evolve <package-or-receipt>
```

The skills-only `starlight-foundry` plugin works as the portable ChatGPT Work/Codex surface. Agent creation fails unless a durable decision-right, memory, tool, ownership, or ongoing-trigger boundary is proven.

[Read the Foundry architecture](docs/architecture/STARLIGHT-INTELLIGENCE-FOUNDRY.md) · [Inspect the contracts](foundry/contracts/) · [Run the demo](foundry/examples/)

## Starlight Agent Designer

The skills-only [Agent Designer plugin](plugins/starlight-agent-designer) turns a human job into a value case, architecture, scoped contract, activation prompt and evaluation plan. Its constitutional foundations include human agency, truthfulness, craftsmanship, privacy, stewardship, creativity and scientific rigor. A tested in-process gateway reference demonstrates bounded preparation; live runtime enforcement remains a separate integration. [Read the design and activation guide](docs/architecture/STARLIGHT-AGENT-DESIGNER.md).

## Usefulness

- **Humans:** portable sovereign memory + multi-agent fleet that compounds.
- **Agents:** shared cognitive architecture, SAGE self-healing patterns, alliance/vertical forge.
- **Portfolio role:** substrate under GenCreator/ACOS/Arcanea ops; mesh and Wealth OS drafts stay issue-tracked until harness-proven.

---
## Two layers, one repo

| Layer              | What it is                                                                 | Best for |
|--------------------|----------------------------------------------------------------------------|----------|
| **SIP (Protocol)** | Open standard. Six clean layers for memory, attestation, commands, and sovereignty. | Forking the protocol or building your own systems |
| **SIS (Reference)** | Complete working system: source-counted agents and skills, six vaults, MCP server, Estate Factory. | Running it as your daily multi-agent brain |

Use the protocol alone, the memory layer alone, or the full reference implementation. They are designed to compose.

**Getting started locally** — [SETUP.md](./SETUP.md) (30-minute full setup including private state).<br>
**Just want the protocol spec** — use the lightweight [SIP kit](https://github.com/frankxai/starlight) instead.

See [CHANGELOG.md](CHANGELOG.md) for history.

[![Built on SIP](https://starlightintelligence.org/badge/v1.1.1)](https://starlightintelligence.org/protocol)

---

## Why It Matters

```mermaid
flowchart TB
  Human["Human intent"] --> Vaults["6 semantic vaults (JSONL truth)"]
  Vaults --> Index["SQLite + FTS5 index"]
  Index --> MCP["MCP server (13 sis_* tools)"]
  MCP --> Adapters["Every CLI you use"]
  Adapters --> Work["Safer, consistent, memory-aware work"]
  Work --> Vaults
```

**The difference**:
- One source of truth instead of N fragmented contexts
- Knowledge that compounds instead of resetting every session
- Attestation so you always know what came from where
- The same memory works in Claude, Cursor, Codex, Gemini — simultaneously

We made the hard parts (temporal decay, contradiction detection, cross-tool sync) automatic.

## For production sovereign systems

Starlight includes a complete **Estate Factory** pattern for running real "Mind + Mesh + Steward" agent armies at scale.

- **Mind**: Your grounded intelligence layers
- **Mesh**: Coordinated swarms with routing, synthesis, and operations
- **Steward**: Health monitoring, evolution, and long-term value

A 4-layer blueprint plus reusable templates lets you stand up new estates quickly while keeping them 100% yours.

![Estate Factory — Mind + Mesh + Steward](docs/visuals/13-estate-factory.jpg)

![Shared attested memory across agents in practice](docs/visuals/14-recall-screenshot.jpg)

Full workflow and templates: `docs/delivery/estate-army-commissioning-workflow.md`.

---

## The substrate (SIP)

**Starlight Intelligence Protocol** — the contract that lets sovereign parties compose intelligence systems without losing sovereignty. Six layers:

1. **File contract** — canonical names and shapes for `SKILL.md`, `AGENTS.md`/`VOICES.md`, `MEMORY.md`, `CANON.md`, `SOUL.md`, `STACK.md`, `.claude/commands/*`, plus `.arc` / `.nea` / `.skill` extensions.
2. **Attestation protocol** — verifiable "Built on SIP" attribution via `/sip-attest`. Refuses decorative use.
3. **MCP registry standard** — how MCP servers declare, compose, version (`mcp.json` schema).
4. **Command taxonomy** — protocol / alliance / vertical / sovereign tiers with explicit decision rights.
5. **Sovereignty + attribution clause** — the non-negotiable social contract.
6. **Archetype extension** — optional canon adoption (Arcanea archetypes available CC-BY-NC).

**Canonical URL:** [starlightintelligence.org/protocol](https://starlightintelligence.org/protocol) · **Source of truth:** [`SIP.md`](SIP.md) in this repo.

### Substrate files at a glance

| File | What it does |
|------|--------------|
| [`SIP.md`](SIP.md) | The protocol spec (six layers). |
| [`SIS.md`](SIS.md) | Substrate map — verticals, composition rules, what SIS does and doesn't provide. |
| [`ALLIANCE.md`](ALLIANCE.md) | The alliance forging method — how 2-5 sovereign nodes compose without collapsing into one entity. |
| [`STACK.md`](STACK.md) | Recommended sovereign stack (L0-L6). Defaults, not mandates. |
| [`VOICES.md`](VOICES.md) | Five canonical voice archetypes (architect, sovereign-creator, protocol-defender, implementer, overseer). |
| [`VERTICALS.md`](VERTICALS.md) | Public registry of sovereign verticals + alliance class definitions. |
| [`MEMORY.md`](MEMORY.md) | Template for per-instance state. |
| [`REGISTRY.md`](REGISTRY.md) | MCP server registry. |
| [`SKILL.md`](SKILL.md) | Substrate-layer behavior (what AI adopts when working at this layer). |
| `.claude/commands/` | 9 substrate-tier slash commands (`/sip-attest`, `/alliance-forge`, `/alliance-reflect`, `/alliance-decide`, `/vertical-spawn`, `/luminor-board`, `/sovereign-signal`, `/openclaw-audit`, `/wealth-dpi`) among 121 total command files. |

![SIP 6-Layer Protocol — the contract that preserves sovereignty while enabling composition.](docs/visuals/12-sip-layers.jpg)

![MCP Server — 13 sis_* tools exposed uniformly to every platform adapter.](docs/visuals/11-mcp-tools.jpg)

### Forge an alliance, spawn a vertical

```bash
# Pressure-test before committing
/luminor-board "Open-source the agent layer or keep it closed?"

# Forge an alliance under SIP
/alliance-forge trinity "architect,sovereign-creator,protocol-defender,implementer"

# Spawn a vertical IS under SIS
/vertical-spawn anime-legends "anime-aesthetic fiction + character design"

# Attest a shipped artifact
/sip-attest path/to/artifact.md
```

Every cross-party artifact carries the "Built on SIP" attestation block. Silent composition is a breach.

---

## The operational layer (reference build)

This repo also ships Frank's working implementation — the daily-driver intelligence system that runs on top of SIP. Use it directly, fork it, or replace it entirely with your own layer above the substrate.

### Quick start (operational layer, 2 minutes)

**Option 1: As an MCP server (recommended for AI tools)**

First, seed your vault directory so the system has somewhere to read from
(a fresh install has no `~/.starlight/vaults` yet):

```bash
# From a git clone of this repo:
node dist/cli.js init --vaults
# → seeds the six JSONL vaults in ~/.starlight/vaults (welcome entry + public examples)
```

Then point your MCP client at that directory:

```json
{
  "mcpServers": {
    "starlight": {
      "command": "node",
      "args": [
        "/path/to/Starlight-Intelligence-System/dist/mcp-server.js",
        "--vault-dir",
        "~/.starlight/vaults"
      ]
    }
  }
}
```

For an npm installation, use `node_modules/@arcanea/starlight-intelligence-system/dist/mcp-server.js` instead; the clone path above is required for the current v8.x workflow.

Restart Claude Code. You now have thirteen `sis_*` tools available in every session.
(If you skip the seed step the server still works — it auto-seeds an empty
`--vault-dir` on first boot so the empty state is never silently broken.)

**Option 2: As a library**

```bash
npm install @arcanea/starlight-intelligence-system@8.5.1
```

```ts
import { StarlightIntelligence } from "@arcanea/starlight-intelligence-system";
import { createAdapter } from "@arcanea/starlight-intelligence-system/adapters";

const sis = new StarlightIntelligence();
sis.initialize();

sis.remember({
  content: "Always Read a file before editing — catches stale state",
  category: "pattern",
  tags: ["workflow", "edit-safety"],
  confidence: 0.95,
});

const adapter = createAdapter("claude-code");
const context = await adapter.generate({ vaultDir: "~/.starlight/vaults" });
```

### The six vaults

| Vault | Symbol | Purpose | Example entry |
|---|---|---|---|
| Strategic | ◆ | Business insights, architecture decisions, competitive moats | `"Open Core + Founding Circle beats premium tiers at this stage"` |
| Technical | ⬡ | Implementation learnings, stack decisions, patterns | `"SQLite FTS5 with bm25 beats embeddings for <10k entries"` |
| Creative | ✦ | Design preferences, aesthetic rules, voice, lore | `"Never Cinzel. Space Grotesk display, Inter body."` |
| Operational | ▸ | Workflow patterns, execution lessons, process rules | `"Max 2 worktrees. Digest pattern for terminal output."` |
| Wisdom | ◎ | Deep principles, truths, cross-domain insights | `"Memory that compounds is intelligence that grows"` |
| Horizon | ↗ | Vision statements, append-only ledger of human intentions | `"Build the substrate that makes AI agents continuous"` |

Each vault is a JSONL file. Human-readable. Git-versionable. Greppable.

![The Six Semantic Vaults — the durable source of truth for every agent you run.](docs/visuals/09-six-vaults.jpg)

> **Where memory lives.** The MCP server and `src/retrieval.ts` read **`*.jsonl`
> files in your `--vault-dir`** (default `~/.starlight/vaults`) — that is the one
> source of truth at runtime. The repo ships two example sets for reference only:
> `public-vault/*.jsonl` is the canonical starter content that `starlight init
> --vaults` copies into your vault dir; `memory/vaults/*.md` are human-readable
> narrative snapshots and are **not** read by the engine. Seed once, then your
> own `~/.starlight/vaults` is what counts.

### What the operational layer adds on top of SIP

- **SQLite hybrid retrieval** — `src/retrieval.ts` builds a rebuildable FTS5 shadow index over JSONL vaults with bm25 ranking. Keyword + temporal today (measured recall in CI via `npm run eval:retrieval`); optional `sqlite-vec` semantic layer is roadmapped in [`docs/bring-your-own-model.md`](docs/bring-your-own-model.md).
- **Temporal reasoning** — `src/temporal.ts` adds validity windows and a 90-day confidence half-life.
- **Contradiction detection** — `src/contradiction.ts` finds conflicting entries via word-trigram Jaccard with opposing-signal boosting.
- **Dreaming** — `src/dreaming.ts` processes session transcripts in the background.
- **Six platform adapters** — Claude Code, Cursor, Codex, Gemini CLI, OpenCode, Antigravity share the same vaults.
- **MCP v2** — `src/mcp-server.ts` ships thirteen tools over JSON-RPC 2.0 stdio.
- **Multi-harness runtime bridge & context continuity** — `@arcanea/starlight-intelligence-system/runtime-bridge` and `src/context-bridge.ts` provide bounded context capture, atomic journal replacement, revision-scoped handoffs, cooperative PID/token locks, and typed review queues.
- **Jev router policy primitive** — `src/runtime-bridge/jev-router.ts` prepares public-only requests from a host-supplied classification and model pool. Post-response checks cannot undo transmission or certify cost.

### MCP tools

| Tool | Description |
|---|---|
| `sis_vault_search` | Free-text search across vaults |
| `sis_recent_entries` | Latest entries from one or all vaults |
| `sis_stats` | Total entry counts per vault |
| `sis_append_entry` | Write a new entry to a vault |
| `sis_entry_types` | List supported vault types and entry categories |
| `sis_search` | Keyword + temporal search (term-overlap score, tag boost, staleness penalty) |
| `sis_confirm` | Touch `lastConfirmed` on an entry |
| `sis_invalidate` | Mark an entry as expired |
| `sis_contradict` | Flag two entries as contradictory |
| `sis_stale` | List entries not confirmed within a threshold |
| `sis_goal_status` | Read the current state of a tracked goal |
| `sis_goal_update` | Update a tracked goal with attested state |
| `sis_goal_log` | Append progress evidence to a tracked goal |

### Platform adapters

| Platform | Memory file | MCP config | Max tokens |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | `~/.claude/settings.json` → `mcpServers` | 200,000 |
| Cursor | `.cursorrules` | Cursor settings → MCP | 128,000 |
| Codex | `AGENTS.md` | `~/.codex/config.toml` | 192,000 |
| Gemini CLI | `GEMINI.md` | `~/.gemini/settings.json` | 1,000,000 |
| OpenCode | `AGENTS.md` (compact) | `~/.config/opencode/opencode.json` | 128,000 |
| Antigravity | `AGENTS.md` | Built-in native tools & MCP | 1,000,000+ |
| Grok | `AGENTS.md` / `GROK.md` | `grok-harness-adapter` | 131,000 |

### Multi-harness runtime bridge & context continuity

The `@arcanea/starlight-intelligence-system/runtime-bridge` export provides `ContextBridge` and `ReviewQueue` for bounded context capture and revision-bound handoffs. The host owns scheduling, provider admission and verification of the receiving checkout.

- Journal writes retain prior events and replace the JSONL file atomically under an owned lock. UUID scratch-file cleanup runs under that same lock; constructing a reader cannot delete a pending writer's file.
- Handoffs select the latest checkpoint for the requested repository and revision. Captured records remain untrusted data; they do not authenticate a repository or establish the receiving checkout's state.
- Cooperative local locks retain a random ownership token, host and PID. Recovery requires the inspected token and an exited local owner. Live, remote and unverifiable owners remain protected; age is never takeover authority.
- Review requests bind the repository, revision, policy and distinct maker/checker providers. Receipts record reported commands, findings and limitations. They are not cryptographically signed or independent proof that those commands ran.
- Jev requests require a host-approved public classification and current model pool. Returned metadata is an untrusted provider report; policy preparation alone does not prove data classification, routing or billed cost.

The source recovery changes require a subsequent root release. Published root `8.5.1` is immutable; merging source does not update its registry archive.

### The 7 named agents (operational layer)

The reference build maps SIP's 5 voice archetypes to 7 named runtime agents — Orchestrator, Prime, Architect, Navigator, Sentinel, Weaver, Sage. Full registry: [`agents/AGENT_REGISTRY.md`](agents/AGENT_REGISTRY.md).

![The core council — seven specialized agents that give the system its judgment, creativity, and execution power.](docs/visuals/10-council.jpg)

Voice archetypes are abstract; named agents are specific implementations. Anyone forking SIP can choose entirely different agents above the substrate.

---

## Fork patterns

| If you want to... | Take | Leave |
|------------------|------|-------|
| Adopt SIP for your own creator stack | `SIP.md`, `SKILL.md`, `VOICES.md`, `.claude/commands/sip-attest.md`, `.claude/commands/alliance-forge.md` | Everything in `agents/`, `memory/`, `skills/`, `src/` |
| Use the MCP memory server, no protocol | `src/`, `dist/`, npm package | Substrate spec files |
| Forge an alliance under SIP | `SIP.md`, `ALLIANCE.md`, `VOICES.md`, the 9 substrate commands in `.claude/commands/` | Operational layer |
| Run the full reference build | All of it | Nothing |

---

## Public canonical URL

[`starlightintelligence.org/protocol`](https://starlightintelligence.org/protocol) mirrors `SIP.md`. This repo is the source of truth.

---

## Architecture (operational layer)

```
            ┌─────────────────────────────────────────┐
            │  JSONL vaults  (source of truth)        │
            │  ~/.starlight/vaults/*.jsonl            │
            │  human-readable · git-versionable       │
            └────────────────┬────────────────────────┘
                             │
                             │  rebuildable from JSONL
                             ▼
            ┌─────────────────────────────────────────┐
            │  SQLite + FTS5  (shadow index)          │
            │  bm25 ranking · temporal filters        │
            └────────────────┬────────────────────────┘
                             │
                             │  JSON-RPC 2.0 over stdio
                             ▼
            ┌─────────────────────────────────────────┐
            │  MCP server  (13 sis_* tools)           │
            └────────────────┬────────────────────────┘
                             │
        ┌────────────────────┼────────────────────────┐
        ▼            ▼       ▼       ▼        ▼       ▼
   Claude Code   Cursor   Codex   Gemini   OpenCode   Your tool
```

![Operational architecture — vaults to index to MCP to all your CLIs, with closed feedback loop.](docs/visuals/16-architecture-flow.jpg)

### Guides

- [Architecture Guide](docs/ARCHITECTURE-GUIDE.md) — full stack map, 10 IS taxonomy, agent architecture, MCP architecture, infrastructure topology, deployment runbook
- [MCP Setup Guide](docs/guides/MCP-SETUP-GUIDE.md) — register the SIS MCP server with every coding agent (Claude Code, Cursor, Windsurf, Codex, Gemini CLI, Antigravity, Hermes) + Railway shared server
- [Hermes + Claude Code + OpenClaw Guide](docs/guides/HERMES-CLAUDE-CODE-GUIDE.md) — dual-stack setup: Hermes on VPS + Claude Code local + OpenClaw on Railway + phone integration
- [Infrastructure Deployment Guide](docs/guides/INFRA-DEPLOYMENT-GUIDE.md) — full 5-surface deployment: Vercel + Railway + VPS + local + phone

---

## Development

```bash
git clone https://github.com/Starlight-Intelligence/Starlight-Intelligence-System.git
cd Starlight-Intelligence-System
npm install
npm run build       # tsc to dist/
npm test            # operational, substrate and v0.1 evaluation suites
npm run lint        # tsc --noEmit
```

`src/` is under 3,000 lines of TypeScript with zero runtime dependencies outside `better-sqlite3`. Substrate docs (`SIP.md`, `SIS.md`, etc.) are markdown-only — no build dependency.

---

## License

- **Code (operational layer + substrate-tier commands):** MIT — see [`LICENSE`](LICENSE).
- **Substrate spec docs** (`SIP.md`, `SIS.md`, `ALLIANCE.md`, `STACK.md`, `VOICES.md`, `VERTICALS.md`, `MEMORY.md`, `REGISTRY.md`, `SKILL.md`): MIT, same `LICENSE`. The "Built on SIP" attestation request is a social-layer convention captured in [`NOTICE`](NOTICE), not a license restriction.
- **Arcanea canon (if your fork composes with it):** CC-BY-NC 4.0, © Arcanea BV. Lives in `frankxai/arcanea-ecosystem`; canon is compose-only — not redistributed under this repo's MIT.
- **Trademarks:** ARCANEA, FRANKX, STARLIGHT INTELLIGENCE — registered or in registration, reserved rights.

"Built on SIP" is an attestation phrase, not a trademark. Use of the phrase requires actual SIP composition per `/sip-attest` rules. Full attribution + canon + trademark summary in [`NOTICE`](NOTICE) (Apache-style — `LICENSE` for legal rights, `NOTICE` for propagation conventions).

---

## Visuals

We treat system diagrams and live-state artifacts as first-class deliverables.

All visuals in `docs/visuals/` follow the same premium dark technical language and carry `Built on SIP` attestation. They are used in the Queen loop, research, and the public site.

Browse them: [docs/visuals/VISUALS.md](docs/visuals/VISUALS.md) · Motion experience: [docs/queen-motion/](docs/queen-motion/)

## Related

- [Arcanea](https://arcanea.ai) — Creator platform; canon-defining vertical built on SIS
- [FrankX](https://frankx.ai) — Architect brand; SIP thought leadership
- [Public Vaults](https://starlightintelligence.org) — Browse and fork vaults
- [Protocol page](https://starlightintelligence.org/protocol) — Canonical SIP spec
- [GitHub](https://github.com/Starlight-Intelligence/Starlight-Intelligence-System) — Source, issues, discussions

---

**Built on SIP** · Starlight Intelligence Protocol · v1.1.1 · v8.5.1 · MIT

---

## Advanced: The Estate Factory

For organizations and sovereign operators who want a full production intelligence estate (not just tools), Starlight provides a complete repeatable delivery system — Mind + Mesh + Steward — with high reuse across engagements.

See `docs/delivery/estate-army-commissioning-workflow.md` and the `templates/estate-os/` profile for the current approach.

### Local persistence and recovery limits

Memory saves replay the committed JSONL log under its advisory lock before
compaction, preserving other writers' records. Save replacements are written to
exclusive sibling files, flushed and renamed. The legacy JSON snapshot is a
derivative and is migrated only when no JSONL log exists, so an older snapshot
cannot resurrect deleted entries. A malformed log stops save without overwriting
its bytes. These are local cooperative filesystem safeguards, not distributed
transaction or whole-filesystem power-loss guarantees.

Administrative stale-lock recovery is serialized by a sibling `.recovery` guard.
An interrupted recoverer leaves its guard and metadata for explicit inspection;
a competing or unverified guard is preserved. Age never permits deletion. PID
reuse, hostile filesystem mutation and other implementations ignoring the guard
remain outside this cooperative protocol. The separate JSONL append lock also
remains intact after an interrupted writer; automatic orphan-lock cleanup is not
implemented here. Exact-revision review and hosted recovery checks remain required.


</details>
