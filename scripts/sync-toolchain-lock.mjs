#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPnpmDependencyLock } from "../tools/foundry/lib/dependency-lock.mjs";
import { assertNoSymlinkPath, hashFile, readJson, writeJson } from "../tools/foundry/lib/io.mjs";

const DEFAULT_LOCK_REL = "foundry/validators/toolchain.lock.v1.json";

function sha256Hex(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function syncSourceClosure(root, label, closure, changes) {
  if (!closure || typeof closure !== "object" || Array.isArray(closure)) return;
  for (const relPath of Object.keys(closure)) {
    const absPath = assertNoSymlinkPath(root, relPath);
    if (!existsSync(absPath) || !lstatSync(absPath).isFile()) {
      throw new Error(`${label} source closure file missing: ${relPath}`);
    }
    const nextDigest = hashFile(absPath).sha256;
    if (closure[relPath] !== nextDigest) {
      changes.push({ field: `${label}.sourceClosure.${relPath}`, before: closure[relPath], after: nextDigest });
      closure[relPath] = nextDigest;
    }
  }
}

function syncImplementationFile(root, label, validator, changes) {
  if (!validator || typeof validator.implementationPath !== "string") return;
  const absPath = assertNoSymlinkPath(root, validator.implementationPath);
  if (!existsSync(absPath) || !lstatSync(absPath).isFile()) {
    throw new Error(`${label} implementation file missing: ${validator.implementationPath}`);
  }
  const nextDigest = hashFile(absPath).sha256;
  if (validator.implementationSha256 !== nextDigest) {
    changes.push({ field: `${label}.implementationSha256`, before: validator.implementationSha256, after: nextDigest });
    validator.implementationSha256 = nextDigest;
  }
}

function syncNpmLockedPackage(label, target, lockPackages, changes) {
  if (!target || typeof target.package !== "string") return;
  const locked = lockPackages?.[`node_modules/${target.package}`];
  if (!locked) return;
  if (target.version !== locked.version) {
    changes.push({ field: `${label}.version`, before: target.version, after: locked.version });
    target.version = locked.version;
  }
  if (target.integrity !== locked.integrity) {
    changes.push({ field: `${label}.integrity`, before: target.integrity, after: locked.integrity });
    target.integrity = locked.integrity;
  }
}

export function inspectToolchainLock(root, lockRelPath = DEFAULT_LOCK_REL) {
  const absRoot = resolve(root);
  const absLockPath = assertNoSymlinkPath(absRoot, lockRelPath);
  const lock = structuredClone(readJson(absLockPath));
  const changes = [];

  const pnpmLockPath = assertNoSymlinkPath(absRoot, "pnpm-lock.yaml");
  const npmLock = existsSync(pnpmLockPath) ? readPnpmDependencyLock(pnpmLockPath) : { packages: {} };

  if (lock.portable?.validator) {
    syncNpmLockedPackage("portable.validator", lock.portable.validator, npmLock.packages, changes);
    syncImplementationFile(absRoot, "portable.validator", lock.portable.validator, changes);
    syncSourceClosure(absRoot, "portable.validator", lock.portable.validator.sourceClosure, changes);
  }

  const provenancePath = join(absRoot, "foundry", "vendor", "agent-plugins", "1.0.0", "provenance.json");
  if (lock.portable && existsSync(provenancePath) && lstatSync(provenancePath).isFile()) {
    const provSha = hashFile(provenancePath).sha256;
    if (lock.portable.provenanceSha256 !== provSha) {
      changes.push({ field: "portable.provenanceSha256", before: lock.portable.provenanceSha256, after: provSha });
      lock.portable.provenanceSha256 = provSha;
    }
  }

  if (lock.openai?.rules?.validator) {
    syncImplementationFile(absRoot, "openai.rules.validator", lock.openai.rules.validator, changes);
    syncSourceClosure(absRoot, "openai.rules.validator", lock.openai.rules.validator.sourceClosure, changes);
  }

  if (lock.openai?.rules?.implementation && typeof lock.openai.rules.implementation === "object") {
    for (const [pkgName, entry] of Object.entries(lock.openai.rules.implementation)) {
      const locked = npmLock.packages?.[`node_modules/${pkgName}`];
      if (!locked) continue;
      if (entry.version !== locked.version) {
        changes.push({ field: `openai.rules.implementation.${pkgName}.version`, before: entry.version, after: locked.version });
        entry.version = locked.version;
      }
      if (entry.integrity !== locked.integrity) {
        changes.push({ field: `openai.rules.implementation.${pkgName}.integrity`, before: entry.integrity, after: locked.integrity });
        entry.integrity = locked.integrity;
      }
    }
  }

  if (lock.openai?.codexLoader) {
    syncSourceClosure(absRoot, "openai.codexLoader", lock.openai.codexLoader.sourceClosure, changes);
  }

  if (lock.claude?.strictValidator) {
    syncSourceClosure(absRoot, "claude.strictValidator", lock.claude.strictValidator.sourceClosure, changes);
  }

  return { absLockPath, changes, nextLock: lock };
}

export function syncToolchainLock({ root, lockPath = DEFAULT_LOCK_REL, check = false } = {}) {
  const { absLockPath, changes, nextLock } = inspectToolchainLock(root, lockPath);
  if (!check && changes.length > 0) {
    writeJson(absLockPath, nextLock);
  }
  return { absLockPath, changes, nextLock, sha256: sha256Hex(absLockPath) };
}

function parseArgs(argv) {
  let check = false;
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let lockPath = DEFAULT_LOCK_REL;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") check = true;
    else if (arg === "--root" && argv[i + 1]) root = resolve(argv[++i]);
    else if (arg === "--lock" && argv[i + 1]) lockPath = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { check, root, lockPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = syncToolchainLock(args);
    if (result.changes.length === 0) {
      console.log(`toolchain lock up to date (${result.changes.length} drifts)`);
      process.exit(0);
    }
    for (const change of result.changes) {
      console.log(`${args.check ? "DRIFT" : "SYNC"} ${change.field}: ${change.before} -> ${change.after}`);
    }
    if (args.check) {
      console.error(`Found ${result.changes.length} toolchain lock drift(s). Run: npm run foundry:lock:sync`);
      process.exit(1);
    }
    console.log(`Updated ${result.changes.length} toolchain lock field(s).`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
