# Starlight Specialist Squads (`starlight.team_profile.v2`)

Six packaged 4-role squads composed strictly from verified SIS specialists (`agents/catalog/specialists.json`) and auto-activating skill rules (`skills/skill-rules.json`), obeying `SYSTEM-SPINE.md §11`:

- **3–5 active roles per squad**, always including a `coordinator`, `maker` role(s), and an `independent_verifier` on a **distinct model family** (`Maker != Checker`).
- **Doctrine 0 fail-closed guards**: `autonomousSpend: false`, `autonomousExternalSend: false`, `requireExactShaReview: true`, `higgsfieldRequiresApprovedPlan: true`.

## Squad Roster

| Squad ID | File | Default Lane | Coordinator | Independent Verifier |
|---|---|---|---|---|
| `web-design-funnel` | `teams/squads/web-design-funnel.team.json` | `flagship` | `starlight-orchestrator` | `starlight-evaluator` |
| `ai-cloud-engineering` | `teams/squads/ai-cloud-engineering.team.json` | `composition` | `starlight-cto` | `starlight-sentinel` |
| `visual-media-canvas` | `teams/squads/visual-media-canvas.team.json` | `flagship` | `starlight-voice-video-is` | `starlight-asset-quality` |
| `content-strategy-copy` | `teams/squads/content-strategy-copy.team.json` | `composition` | `starlight-cmo` | `starlight-social-factcheck` |
| `knowledge-memory-ops` | `teams/squads/knowledge-memory-ops.team.json` | `composition` | `starlight-sage` | `divine-neutral-witness` |
| `adversarial-release-ops` | `teams/squads/adversarial-release-ops.team.json` | `mechanical` | `starlight-chief-of-staff` | `builder-elder`, `shadow-witness` |

## Validation

```sh
node scripts/validate-teams.mjs
node --import tsx --test test/team-profiles.test.ts
```

Note: Team profiles describe role topology, personality voice, skill bindings, and verification rubrics; runtime permissions remain governed by the executing harness and MCP server boundaries.
