import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectToolchainLock, syncToolchainLock } from "../scripts/sync-toolchain-lock.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "sis-lock-sync-"));
  const files = [
    "package.json",
    "pnpm-lock.yaml",
    "foundry/validators/toolchain.lock.v1.json",
    "foundry/validators/native/package.json",
    "foundry/validators/native/package-lock.json",
    "foundry/contracts/openai-submission-profile.schema.json",
    "foundry/vendor/agent-plugins/1.0.0/provenance.json",
    "tools/foundry/codex-loader-smoke.mjs",
    "tools/foundry/claude-validator-smoke.mjs",
    "tools/foundry/lib/dependency-lock.mjs",
    "tools/foundry/lib/io.mjs",
    "tools/foundry/lib/openai-preflight.mjs",
    "tools/foundry/lib/package-payload.mjs",
    "tools/foundry/lib/schema.mjs",
    "tools/foundry/lib/upstream-conformance.mjs",
  ];
  for (const rel of files) {
    cpSync(join(REPO_ROOT, rel), join(dir, rel), { recursive: false });
  }
  return dir;
}

test("inspectToolchainLock reports 0 drifts on current repository state", () => {
  const result = inspectToolchainLock(REPO_ROOT);
  assert.deepEqual(result.changes, []);
});

test("syncToolchainLock detects package.json digest drift in --check mode and repairs it on sync", () => {
  const fixture = makeFixtureRepo();
  try {
    const pkgPath = join(fixture, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.scripts = { ...pkg.scripts, "foundry:lock:test": "echo ok" };
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

    const checkBefore = syncToolchainLock({ root: fixture, check: true });
    assert.ok(checkBefore.changes.some((c) => c.field === "portable.validator.sourceClosure.package.json"));
    assert.ok(checkBefore.changes.some((c) => c.field === "openai.rules.validator.sourceClosure.package.json"));

    const synced = syncToolchainLock({ root: fixture, check: false });
    assert.equal(synced.changes.length, checkBefore.changes.length);

    const checkAfter = syncToolchainLock({ root: fixture, check: true });
    assert.deepEqual(checkAfter.changes, []);

    const defaultCall = syncToolchainLock({ root: fixture });
    assert.deepEqual(defaultCall.changes, []);

    rmSync(join(fixture, "foundry/vendor/agent-plugins/1.0.0/provenance.json"));
    assert.throws(() => inspectToolchainLock(fixture), /provenance is missing/i);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
