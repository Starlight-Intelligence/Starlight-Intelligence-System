import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getContract, loadContractRegistry, validateValue } from "../tools/foundry/lib/schema.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INDEX = join(ROOT, "foundry", "capability-index");
const registry = loadContractRegistry(join(ROOT, "foundry", "contracts"));

const text = (path) => readFileSync(path, "utf8");
const jsonl = (name) =>
  text(join(INDEX, "data", name))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const receipts = jsonl("receipts.jsonl");
const sketches = jsonl("sketches.jsonl");
const graph = JSON.parse(text(join(INDEX, "data", "capability-graph.json")));
const sources = JSON.parse(text(join(INDEX, "sources.json")));

describe("Capability index data", () => {
  it("validates every receipt against the foundry receipt contract", () => {
    const contract = getContract(registry, "capability-receipt");
    const failures = receipts
      .map((receipt) => ({ id: receipt.artifact_id, result: validateValue(receipt, contract, registry) }))
      .filter((entry) => !entry.result.valid)
      .map((entry) => `${entry.id}: ${JSON.stringify(entry.result.errors.slice(0, 2))}`);
    assert.deepEqual(failures, []);
  });

  it("rejects receipts that carry unknown fields, malformed hashes or overlong text", () => {
    const contract = getContract(registry, "capability-receipt");
    const base = receipts.find((receipt) => receipt.estate === "external" && receipt.kind === "skill");
    const mutations = [
      ["unknown top-level field", (r) => ({ ...r, body: "the whole artifact" }), "ADDITIONAL_PROPERTY"],
      ["short commit", (r) => ({ ...r, source: { ...r.source, commit: "abc123" } }), "PATTERN"],
      ["overlong description", (r) => ({ ...r, frontmatter: { ...r.frontmatter, description: "x".repeat(241) } }), "MAX_LENGTH"],
      ["unknown verdict", (r) => ({ ...r, security_verdict: "fine" }), "ENUM"],
    ];
    for (const [label, mutate, code] of mutations) {
      const result = validateValue(mutate(structuredClone(base)), contract, registry);
      assert.equal(result.valid, false, label);
      assert.ok(result.errors.some((error) => error.code === code), `${label}: ${JSON.stringify(result.errors)}`);
    }
  });

  it("validates the exported graph with the foundry capability-graph contract and its alias rules", () => {
    const result = validateValue(graph, getContract(registry, "capability-graph"), registry);
    assert.equal(result.valid, true, JSON.stringify(result.errors.slice(0, 5)));
    assert.ok(graph.nodes.some((node) => node.aliases?.length), "expected at least one collapsed duplicate");
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    for (const node of graph.nodes) {
      for (const alias of node.aliases ?? []) assert.equal(nodeIds.has(alias), false, `${alias} is both node and alias`);
    }
  });

  it("accounts for every skill receipt exactly once as a node or an alias", () => {
    const skills = receipts.filter((receipt) => receipt.kind === "skill");
    const aliases = graph.nodes.reduce((sum, node) => sum + (node.aliases?.length ?? 0), 0);
    assert.equal(graph.nodes.length + aliases, skills.length);
  });

  it("keeps receipt ids unique and sketches tied to receipts", () => {
    const ids = receipts.map((receipt) => receipt.artifact_id);
    assert.equal(new Set(ids).size, ids.length);
    const known = new Set(ids);
    for (const sketch of sketches) assert.ok(known.has(sketch.artifact_id), sketch.artifact_id);
  });

  it("pins every receipt to a source commit declared in sources.json", () => {
    const pins = new Map(sources.sources.map((source) => [source.url, source.commit]));
    for (const source of sources.sources) assert.match(source.commit, /^[0-9a-f]{40}$/, source.slug);
    for (const receipt of receipts) {
      assert.equal(pins.get(receipt.source.repository), receipt.source.commit, receipt.artifact_id);
    }
  });

  it("covers 100 external artifacts across at least five repositories", () => {
    const external = receipts.filter((receipt) => receipt.estate === "external");
    assert.equal(external.length, 100);
    assert.ok(new Set(external.map((receipt) => receipt.source.repository)).size >= 5);
  });

  it("never stores a secret-shaped string or an artifact body", () => {
    const patterns = [/(?<![A-Za-z0-9_])gh[op]_[A-Za-z0-9]{16,}/, /github_pat_[A-Za-z0-9_]{20,}/, /(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{20,}/, /xoxb-[A-Za-z0-9-]{16,}/, /AKIA[0-9A-Z]{16}/];
    for (const name of ["receipts.jsonl", "sketches.jsonl", "conflicts.jsonl", "capability-graph.json"]) {
      const body = text(join(INDEX, "data", name));
      for (const pattern of patterns) assert.equal(pattern.test(body), false, `${name} matches ${pattern}`);
    }
    for (const receipt of receipts) assert.ok(receipt.frontmatter.description.length <= 240, receipt.artifact_id);
  });

  it("holds the preregistered evaluation thresholds to their recorded hash", () => {
    const digest = createHash("sha256").update(readFileSync(join(INDEX, "evals", "prereg.json"))).digest("hex");
    assert.equal(digest, text(join(INDEX, "evals", "prereg.json.sha256")).split(/\s+/)[0]);
  });
});
