// Built on SIP: tests for scripts/check-stack-registry.mjs.
// Run: node --test test/stack-registry.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  REGISTRY_PATH,
  REPO_ROOT,
  SCHEMA_PATH,
  SITE_COPY_PATH,
  checkRegistry,
  loadSkillRuleIds,
  siteCopy,
  validateSchema,
} from "../scripts/check-stack-registry.mjs";

const read = (p) => readFileSync(join(REPO_ROOT, ...p.split("/")), "utf8");
const registry = JSON.parse(read(REGISTRY_PATH));
const schema = JSON.parse(read(SCHEMA_PATH));
const skillRuleIds = loadSkillRuleIds(REPO_ROOT);
const clone = () => structuredClone(registry);
const check = (r) => checkRegistry(r, { schema, skillRuleIds });
const expectError = (r, fragment) => {
  const errors = check(r);
  assert.ok(errors.some((e) => e.includes(fragment)), `expected an error containing "${fragment}", got:\n${errors.join("\n")}`);
};

test("the committed registry passes every rule", () => {
  assert.deepEqual(check(registry), []);
});

test("the site copy matches the registry", () => {
  assert.equal(read(SITE_COPY_PATH).replace(/\r\n/g, "\n"), siteCopy(registry));
});

test("schema: unknown properties and bad status values fail", () => {
  const r = clone();
  r.providers[0].apiKey = "x";
  r.runtimes[0].status = "deployed";
  const errors = validateSchema(r, schema);
  assert.ok(errors.some((e) => e.includes("unknown property apiKey")));
  assert.ok(errors.some((e) => e.includes("must be one of live, wired, planned")));
});

test("a missing evidence path fails", () => {
  const r = clone();
  r.runtimes[0].evidence.push("services/does-not-exist/wrangler.toml");
  expectError(r, "does not exist");
});

test("a path outside the repository fails", () => {
  const r = clone();
  r.runtimes[0].evidence.push("../outside.json");
  expectError(r, "repository-relative");
});

test("an unregistered agent id fails", () => {
  const r = clone();
  r.deployments.find((d) => d.agent.kind === "registered").agent.id = "starlight-invented";
  expectError(r, "has no profile at agents/starlight-invented.md");
});

test("a service identity absent from its evidence fails", () => {
  const r = clone();
  r.deployments.find((d) => d.agent.kind === "service-identity").agent.id = "ghost-worker";
  expectError(r, "service identity ghost-worker");
});

test("secret-looking strings fail", () => {
  for (const value of ["sk-ant-abcdefghijklmnopqrstuvwx", "ghp_abcdefghijklmnopqrstuvwxyz0123", "ANTHROPIC_API_KEY=abc123", "Zx9Kq2LmPw8Rt5Yv3Nb7Hc1Jd6Fg4Sa0QeWuIoPlMk"]) {
    const r = clone();
    r.providers[0].notes = value;
    expectError(r, "looks like a secret");
  }
});

test("an env var value instead of a name fails the schema", () => {
  const r = clone();
  r.providers[0].surface.envVars = ["ANTHROPIC_API_KEY=abc"];
  expectError(r, "does not match");
});

test("an env var name absent from the provider's evidence fails", () => {
  const r = clone();
  r.providers.find((p) => p.id === "anthropic").surface.envVars.push("MADE_UP_PROVIDER_KEY");
  expectError(r, "env var MADE_UP_PROVIDER_KEY");
});

test("live without a liveCheck fails", () => {
  const r = clone();
  delete r.runtimes.find((x) => x.status === "live").liveCheck;
  expectError(r, "live needs a liveCheck");
});

test("wired with only documents fails", () => {
  const r = clone();
  const row = r.runtimes.find((x) => x.id === "oci");
  row.status = "wired";
  expectError(r, "wired needs at least one code or config evidence path");
});

test("planned with deploy evidence fails", () => {
  const r = clone();
  r.providers.find((p) => p.status === "planned").deployEvidence = [".github/workflows/vercel-deploy.yml"];
  expectError(r, "planned must not carry deployEvidence");
});

test("a deployment cannot be ahead of its runtime", () => {
  const r = clone();
  const d = r.deployments.find((x) => x.runtime === "cf-harness");
  d.status = "live";
  d.deployEvidence = [".github/workflows/vercel-deploy.yml"];
  d.liveCheck = { url: "https://example.org", observedAt: "2026-11-27", httpStatus: 200, note: "test" };
  expectError(r, "is ahead of runtime cf-harness");
});

test("an MCP tool missing from its entry file fails", () => {
  const r = clone();
  r.mcpServers[0].tools.push("tool_that_does_not_exist");
  expectError(r, "tool tool_that_does_not_exist does not appear");
});

test("an unknown skill rule id fails", () => {
  const r = clone();
  r.deployments.find((d) => d.skills.length > 0).skills.push("made-up-skill");
  expectError(r, "skill made-up-skill");
});
