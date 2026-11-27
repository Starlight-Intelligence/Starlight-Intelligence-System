import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTeams } from '../scripts/validate-teams.mjs';

test('all 6 specialist squads conform to starlight.team_profile.v2, real SIS agents/skills, and Maker != Checker', () => {
  const result = validateTeams();
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.equal(result.squadCount, 6);
});
