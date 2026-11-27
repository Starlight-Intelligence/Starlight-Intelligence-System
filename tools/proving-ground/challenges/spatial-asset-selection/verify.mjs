import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { lexicalPredictions } from './baseline.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

// Fixtures and validated submission data contain only JSON scalars, arrays and
// objects. Sort object fields recursively; array order remains significant.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export const digest = value => sha256(JSON.stringify(canonical(value)));
const load = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));

export function loadSuite() {
  const catalog = load('catalog.json');
  const prompts = load('prompts.json');
  const cases = load('cases.json');
  const suiteSha256 = digest({catalog, prompts, cases});
  if (suiteSha256 !== load('suite.lock.json').suite_sha256) {
    throw new Error('Frozen suite digest mismatch');
  }
  const assets = new Set(catalog.assets.map(row => row.id));
  const queries = new Set(prompts.map(row => row.id));
  const labels = new Set(cases.cases.map(row => row.id));
  if (assets.size !== catalog.assets.length || queries.size !== prompts.length ||
      labels.size !== cases.cases.length || queries.size !== labels.size ||
      cases.cases.some(row => !queries.has(row.id) || (row.expected !== null && !assets.has(row.expected)))) {
    throw new Error('Inconsistent frozen IDs');
  }
  return {catalog, prompts, cases, suiteSha256};
}

function readSubmission(path) {
  // A fixed read limit also bounds a file that grows between stat and read.
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 65_536) throw new Error('Expected a regular file up to 64 KiB');
    const buffer = Buffer.alloc(65_537);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > 65_536) throw new Error('Submission exceeds 64 KiB');
    return buffer.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}

export function score(input, suite = loadSuite()) {
  if (Buffer.byteLength(input) > 65_536) throw new Error('Submission exceeds 64 KiB');
  const rows = JSON.parse(input);
  if (!Array.isArray(rows)) throw new Error('Supply a JSON array of [caseId, assetIdOrNull] pairs');
  if (rows.length !== suite.prompts.length) throw new Error('Exactly one row per case is required');
  const assetIds = new Set(suite.catalog.assets.map(row => row.id));
  const caseIds = new Set(suite.prompts.map(row => row.id));
  const predictions = new Map();
  for (const pair of rows) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error('Expected a two-element pair');
    const [id, picked] = pair;
    if (!caseIds.has(id)) throw new Error('Unknown case ID');
    if (predictions.has(id)) throw new Error('Duplicate case ID');
    if (picked !== null && !assetIds.has(picked)) throw new Error('Expected known asset ID or null');
    predictions.set(id, picked);
  }
  const ordered = Array.from(caseIds).sort().map(id => [id, predictions.get(id)]);
  const results = suite.cases.cases.map(({id, expected}) => {
    const selected = predictions.get(id);
    let outcome;
    if (expected === null) outcome = selected === null ? 'correct_abstention' : 'false_selection_on_abstain';
    else if (selected === null) outcome = 'missed_selection';
    else outcome = selected === expected ? 'correct_selection' : 'wrong_selection';
    return {id, expected, selected, outcome};
  });
  const metrics = {correct_selection: 0, wrong_selection: 0, missed_selection: 0,
    correct_abstention: 0, false_selection_on_abstain: 0};
  for (const {outcome} of results) metrics[outcome]++;
  const qualified = metrics.correct_selection >= suite.cases.minimum_correct_selections &&
    metrics.false_selection_on_abstain <= suite.cases.maximum_false_selections_on_abstain;
  return {
    challenge: suite.cases.challenge,
    scope: suite.cases.scope,
    verdict: qualified ? 'qualified_on_public_cases' : 'below_public_threshold',
    suite_sha256: suite.suiteSha256,
    verifier_sha256: sha256(readFileSync(new URL('./verify.mjs', import.meta.url))),
    submission_file_sha256: sha256(input),
    predictions_sha256: digest(ordered),
    metrics, results
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const [action, path, ...extra] = process.argv.slice(2);
    const suite = loadSuite();
    let result;
    if (!extra.length && action === 'score' && path) {
      const input = readSubmission(path);
      result = score(input, suite);
    } else if (!path && (action === 'baseline' || action === 'always-select')) {
      result = lexicalPredictions(suite.catalog.assets, suite.prompts, {forceSelection: action === 'always-select'});
    } else {
      throw new Error('Use baseline, always-select, or score PREDICTIONS.json');
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
