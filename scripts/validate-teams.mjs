#!/usr/bin/env node
/**
 * Validates all Starlight specialist squad profiles (`starlight.team_profile.v2`)
 * against the canonical SIS specialist catalog and skill activation rules.
 *
 * Built on SIP — operational tier (zero phantom agents or skills).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const squadDir = path.join(root, 'teams', 'squads');

function readJson(relPath) {
  return JSON.parse(readFileSync(path.join(root, relPath), 'utf8'));
}

export function validateTeams() {
  const failures = [];
  const specialists = readJson('agents/catalog/specialists.json');
  const validAgentIds = new Set(
    (specialists.agents ?? []).map((agent) => agent.id || agent.stableId).filter(Boolean),
  );
  const skillRules = readJson('skills/skill-rules.json');
  const validSkillIds = new Set((skillRules.rules ?? []).map((rule) => rule.skill).filter(Boolean));

  const index = readJson('teams/squads/index.json');
  const files = readdirSync(squadDir).filter((name) => name.endsWith('.team.json'));
  const indexedIds = new Set((index.squads ?? []).map((s) => s.id));

  if (files.length !== 6) {
    failures.push(`Expected 6 .team.json files in teams/squads/, found ${files.length}`);
  }

  for (const entry of index.squads ?? []) {
    if (!existsSync(path.join(root, entry.path))) {
      failures.push(`index.json references missing squad file: ${entry.path}`);
    }
  }

  const loadedSquads = [];
  for (const file of files) {
    const rel = `teams/squads/${file}`;
    const squad = readJson(rel);
    loadedSquads.push(squad);

    if (squad.schemaVersion !== 'starlight.team_profile.v2') {
      failures.push(`${rel}: schemaVersion must be starlight.team_profile.v2`);
    }
    if (!indexedIds.has(squad.id)) {
      failures.push(`${rel}: id '${squad.id}' is not listed in teams/squads/index.json`);
    }
    if (!['mechanical', 'composition', 'flagship'].includes(squad.defaultLane)) {
      failures.push(`${rel}: invalid defaultLane '${squad.defaultLane}'`);
    }
    const roles = Array.isArray(squad.roles) ? squad.roles : [];
    if (roles.length < 3 || roles.length > 5) {
      failures.push(`${rel}: roles count must be 3..5 (got ${roles.length})`);
    }

    const coordinators = roles.filter((r) => r.role === 'coordinator');
    const makers = roles.filter((r) => r.role === 'maker');
    const verifiers = roles.filter((r) => r.role === 'independent_verifier');
    if (coordinators.length < 1) failures.push(`${rel}: missing coordinator role`);
    if (makers.length < 1) failures.push(`${rel}: missing maker role`);
    if (verifiers.length < 1) failures.push(`${rel}: missing independent_verifier role`);

    const makerFamilies = new Set(makers.map((m) => String(m.preferredModelFamily || '').toLowerCase()));
    const distinctCheckerExists = verifiers.some(
      (v) => !makerFamilies.has(String(v.preferredModelFamily || '').toLowerCase()),
    );
    if (!distinctCheckerExists) {
      failures.push(`${rel}: Maker != Checker violated (verifier must use a different preferredModelFamily from makers)`);
    }

    for (const role of roles) {
      if (!validAgentIds.has(role.agentId)) {
        failures.push(`${rel}: unknown agentId '${role.agentId}' (not in agents/catalog/specialists.json)`);
      }
      if (!Array.isArray(role.skills) || role.skills.length === 0) {
        failures.push(`${rel}: role '${role.agentId}' must declare at least 1 skill`);
      }
      for (const skill of role.skills ?? []) {
        if (!validSkillIds.has(skill)) {
          failures.push(`${rel}: unknown skill '${skill}' (not in skills/skill-rules.json)`);
        }
      }
    }

    const guards = squad.doctrine0Guards ?? {};
    if (guards.autonomousSpend !== false || guards.autonomousExternalSend !== false || guards.requireExactShaReview !== true || guards.higgsfieldRequiresApprovedPlan !== true) {
      failures.push(`${rel}: doctrine0Guards must fail closed on spend, external send, exact-SHA review, and Higgsfield plan gate`);
    }
    if (!Array.isArray(squad.acceptanceRubric) || squad.acceptanceRubric.length < 2) {
      failures.push(`${rel}: acceptanceRubric must contain at least 2 verifiable checks`);
    }
  }

  return { ok: failures.length === 0, squadCount: loadedSquads.length, failures };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('validate-teams.mjs')) {
  const result = validateTeams();
  if (!result.ok) {
    console.error('validate-teams FAILED:\n' + result.failures.map((f) => `- ${f}`).join('\n'));
    process.exit(1);
  }
  console.log(`validate-teams PASS (${result.squadCount} squads verified against specialists.json + skill-rules.json)`);
}
