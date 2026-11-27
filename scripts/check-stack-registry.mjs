#!/usr/bin/env node
// Built on SIP: checks platform/stack-registry.v1.json, the one record of which agent runs
// where, on which model, with which tools.
//
//   node scripts/check-stack-registry.mjs           validate, and fail if the site copy drifted
//   node scripts/check-stack-registry.mjs --write   validate, then write the site copy
//
// Zero dependencies. The schema subset below covers every keyword that
// schemas/stack-registry.v1.schema.json uses; anything else fails closed.
//
// Beyond the schema it checks that every evidence path exists, every registered agent id has a
// profile under agents/, every service identity appears in its own evidence, every MCP tool name
// appears in its server's entry file, every env var name appears in its provider's evidence, no
// string looks like a secret, and every status obeys the evidence rules in statusRules.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..");
export const REGISTRY_PATH = "platform/stack-registry.v1.json";
export const SCHEMA_PATH = "schemas/stack-registry.v1.schema.json";
export const SITE_COPY_PATH = "site/src/lib/generated/stack-registry.json";

const STATUS_RANK = { planned: 0, wired: 1, live: 2 };
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".txt"]);

// Shapes that should never sit in a registry. Model ids and repo paths do not match these.
const SECRET_PATTERNS = [
  [/sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/, "API key prefix sk-"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token"],
  [/github_pat_[A-Za-z0-9_]{20,}/, "GitHub fine-grained token"],
  [/xox[abprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/AIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/, "JSON web token"],
  [/\b[A-Fa-f0-9]{32,}\b/, "long hex string"],
  [/\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*\S+/, "env var assignment"],
];

// A run of 40+ token characters that mixes upper case, lower case, and digits, and is not a
// hyphenated file name (those carry several hyphens), reads as an opaque credential.
function hasOpaqueToken(text) {
  return (text.match(/[A-Za-z0-9+_-]{40,}/g) ?? []).some(
    (t) => /[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t) && (t.match(/-/g) ?? []).length < 3,
  );
}

// ---------- minimal JSON Schema (draft 2020-12 subset) ----------

const SUPPORTED = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "description", "type", "const", "enum", "pattern",
  "minLength", "minItems", "required", "properties", "additionalProperties", "items", "oneOf",
]);

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref ${ref}`);
  return ref.slice(2).split("/").reduce((node, key) => {
    if (!node || !(key in node)) throw new Error(`unresolved $ref ${ref}`);
    return node[key];
  }, root);
}

export function validateSchema(value, schema, root = schema, at = "$") {
  const errors = [];
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) throw new Error(`schema keyword ${key} at ${at} is not supported by this checker`);
  }
  if (schema.$ref) return validateSchema(value, resolveRef(root, schema.$ref), root, at);
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((sub) => validateSchema(value, sub, root, at).length === 0).length;
    if (passing !== 1) errors.push(`${at}: must match exactly one schema in oneOf (matched ${passing})`);
    return errors;
  }
  const actual = typeOf(value);
  if (schema.type) {
    const ok = schema.type === actual || (schema.type === "number" && actual === "integer");
    if (!ok) return [`${at}: expected ${schema.type}, got ${actual}`];
  }
  if ("const" in schema && value !== schema.const) errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.join(", ")}`);
  if (actual === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
  }
  if (actual === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((item, i) => errors.push(...validateSchema(item, schema.items, root, `${at}[${i}]`)));
  }
  if (actual === "object") {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${at}: missing required ${key}`);
    const props = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      if (props[key]) errors.push(...validateSchema(child, props[key], root, `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: unknown property ${key}`);
    }
  }
  return errors;
}

// ---------- evidence and consistency rules ----------

function isSafeRelative(path) {
  return !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.split("/").includes("..");
}

function fileText(root, path, cache) {
  if (!cache.has(path)) {
    const abs = join(root, ...path.split("/"));
    cache.set(path, existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, "utf8") : null);
  }
  return cache.get(path);
}

function isCodeOrConfig(path) {
  return !DOC_EXTENSIONS.has(extname(path).toLowerCase());
}

function walkStrings(value, at, out) {
  if (typeof value === "string") out.push([at, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${at}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walkStrings(v, `${at}.${k}`, out);
  return out;
}

export function loadSkillRuleIds(root) {
  const rules = JSON.parse(readFileSync(join(root, "skills", "skill-rules.json"), "utf8"));
  return new Set((rules.rules ?? []).map((r) => r.id));
}

export function checkRegistry(registry, { root = REPO_ROOT, schema, skillRuleIds } = {}) {
  const errors = [];
  const schemaDoc = schema ?? JSON.parse(readFileSync(join(root, SCHEMA_PATH), "utf8"));
  errors.push(...validateSchema(registry, schemaDoc));
  if (errors.length > 0) return errors; // the rules below assume the shape is right

  const cache = new Map();
  const skills = skillRuleIds ?? loadSkillRuleIds(root);

  for (const [at, text] of walkStrings(registry, "$", [])) {
    for (const [pattern, label] of SECRET_PATTERNS) {
      if (pattern.test(text)) errors.push(`${at}: looks like a secret (${label}); store env var names only`);
    }
    if (hasOpaqueToken(text)) errors.push(`${at}: looks like a secret (long opaque token); store env var names only`);
  }

  const sections = ["providers", "runtimes", "agentSpecs", "mcpServers", "deployments"];
  const byId = {};
  for (const section of sections) {
    byId[section] = new Map();
    registry[section].forEach((row, i) => {
      if (byId[section].has(row.id)) errors.push(`${section}[${i}]: duplicate id ${row.id}`);
      byId[section].set(row.id, row);
    });
  }

  const checkPaths = (at, paths) => {
    for (const path of paths ?? []) {
      if (!isSafeRelative(path)) errors.push(`${at}: ${path} must be a repository-relative path`);
      else if (fileText(root, path, cache) === null) errors.push(`${at}: evidence path ${path} does not exist`);
    }
  };

  const checkStatus = (at, row) => {
    const code = [...row.evidence, ...(row.validatedBy ?? []), ...(row.entry ? [row.entry] : [])].filter(isCodeOrConfig);
    if (row.status === "live") {
      if (!row.deployEvidence) errors.push(`${at}: live needs deployEvidence`);
      if (!row.liveCheck) errors.push(`${at}: live needs a liveCheck`);
      else if (row.liveCheck.httpStatus < 200 || row.liveCheck.httpStatus >= 400) {
        errors.push(`${at}: live needs a liveCheck that answered 2xx or 3xx, got ${row.liveCheck.httpStatus}`);
      }
      if (code.length === 0) errors.push(`${at}: live needs at least one code or config evidence path`);
    } else if (row.status === "wired") {
      if (code.length === 0) errors.push(`${at}: wired needs at least one code or config evidence path, not only documents`);
      if (row.liveCheck) errors.push(`${at}: a liveCheck means the row should be live, or the check removed`);
    } else if (row.status === "planned") {
      if (row.deployEvidence || row.liveCheck) errors.push(`${at}: planned must not carry deployEvidence or liveCheck`);
    }
  };

  for (const section of sections) {
    registry[section].forEach((row, i) => {
      const at = `${section}[${i}] ${row.id}`;
      checkPaths(at, row.evidence);
      checkPaths(at, row.deployEvidence);
      checkPaths(at, row.validatedBy);
      if (row.entry) checkPaths(at, [row.entry]);
      checkStatus(at, row);
    });
  }

  registry.providers.forEach((p, i) => {
    const at = `providers[${i}] ${p.id}`;
    for (const name of p.surface.envVars) {
      const seen = p.evidence.some((path) => (fileText(root, path, cache) ?? "").includes(name));
      if (!seen) errors.push(`${at}: env var ${name} does not appear in any of its evidence files`);
    }
  });

  const runtimeRank = (id) => STATUS_RANK[byId.runtimes.get(id)?.status];

  registry.mcpServers.forEach((m, i) => {
    const at = `mcpServers[${i}] ${m.id}`;
    if (m.runtime !== null) {
      if (!byId.runtimes.has(m.runtime)) errors.push(`${at}: unknown runtime ${m.runtime}`);
      else if (STATUS_RANK[m.status] > runtimeRank(m.runtime)) errors.push(`${at}: status ${m.status} is ahead of runtime ${m.runtime}`);
    }
    const entry = fileText(root, m.entry, cache) ?? "";
    for (const tool of m.tools) {
      if (!new RegExp(`\\b${tool}\\b`).test(entry)) errors.push(`${at}: tool ${tool} does not appear in ${m.entry}`);
    }
  });

  registry.deployments.forEach((d, i) => {
    const at = `deployments[${i}] ${d.id}`;
    if (d.agent.kind === "registered") {
      if (fileText(root, `agents/${d.agent.id}.md`, cache) === null) {
        errors.push(`${at}: registered agent ${d.agent.id} has no profile at agents/${d.agent.id}.md`);
      }
    } else if (!d.evidence.some((path) => (fileText(root, path, cache) ?? "").includes(d.agent.id))) {
      errors.push(`${at}: service identity ${d.agent.id} does not appear in any of its evidence files`);
    }
    if (!byId.runtimes.has(d.runtime)) errors.push(`${at}: unknown runtime ${d.runtime}`);
    else if (STATUS_RANK[d.status] > runtimeRank(d.runtime)) errors.push(`${at}: status ${d.status} is ahead of runtime ${d.runtime}`);
    const provider = byId.providers.get(d.modelRoute.provider);
    if (!provider) errors.push(`${at}: unknown provider ${d.modelRoute.provider}`);
    else if (d.modelRoute.calls && STATUS_RANK[d.status] > STATUS_RANK[provider.status]) {
      errors.push(`${at}: status ${d.status} is ahead of provider ${provider.id} (${provider.status})`);
    }
    if (d.modelRoute.via) {
      const via = byId.providers.get(d.modelRoute.via);
      if (!via) errors.push(`${at}: unknown gateway ${d.modelRoute.via}`);
      else if (via.kind !== "gateway") errors.push(`${at}: via ${via.id} is not a gateway`);
    }
    for (const id of d.mcpServers) if (!byId.mcpServers.has(id)) errors.push(`${at}: unknown MCP server ${id}`);
    for (const id of d.skills) if (!skills.has(id)) errors.push(`${at}: skill ${id} is not a rule id in skills/skill-rules.json`);
  });

  return errors;
}

/** The copy the site imports: same data, minus the repo-relative $schema pointer. */
export function siteCopy(registry) {
  const { $schema: _schema, ...rest } = registry;
  return `${JSON.stringify(rest, null, 2)}\n`;
}

export function counts(registry) {
  const byStatus = (rows) => rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  return Object.fromEntries(
    ["providers", "runtimes", "agentSpecs", "mcpServers", "deployments"].map((s) => [s, { total: registry[s].length, ...byStatus(registry[s]) }]),
  );
}

function main() {
  const write = process.argv.includes("--write");
  const registry = JSON.parse(readFileSync(join(REPO_ROOT, REGISTRY_PATH), "utf8"));
  const errors = checkRegistry(registry);
  if (errors.length > 0) {
    console.error(`[stack-registry] ${errors.length} problem(s) in ${REGISTRY_PATH}:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const expected = siteCopy(registry);
  const copyAbs = join(REPO_ROOT, ...SITE_COPY_PATH.split("/"));
  if (write) {
    mkdirSync(dirname(copyAbs), { recursive: true });
    writeFileSync(copyAbs, expected);
    console.log(`[stack-registry] wrote ${SITE_COPY_PATH}`);
  } else {
    const actual = existsSync(copyAbs) ? readFileSync(copyAbs, "utf8").replace(/\r\n/g, "\n") : null;
    if (actual !== expected) {
      console.error(`[stack-registry] ${SITE_COPY_PATH} is out of date. Run: node scripts/check-stack-registry.mjs --write`);
      process.exit(1);
    }
  }
  const c = counts(registry);
  const line = Object.entries(c).map(([s, v]) => `${s} ${v.total} (live ${v.live ?? 0}, wired ${v.wired ?? 0}, planned ${v.planned ?? 0})`).join("; ");
  console.log(`[stack-registry] OK: ${line}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
