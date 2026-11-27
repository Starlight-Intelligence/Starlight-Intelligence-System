import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lexicalPredictions } from './baseline.mjs';
import { digest, loadSuite, score } from './verify.mjs';

const suite = loadSuite();
const gold = () => suite.cases.cases.map(row => [row.id, row.expected]);
const evaluate = rows => score(JSON.stringify(rows), suite);
const clone = value => structuredClone(value);
const baseline = lexicalPredictions(suite.catalog.assets, suite.prompts);
const measurements = JSON.parse(readFileSync(new URL('reference-results.json', import.meta.url)));

test('case labels never enter the participant prompt projection', () => {
  for (const row of suite.prompts) assert.deepEqual(Object.keys(row).sort(), ['id', 'intent']);
  assert.equal(suite.cases.cases.filter(row => row.expected === null).length, 4);
});
test('observed baseline and adverse metrics reproduce; misses remain visible', () => {
  for (const record of measurements.runs) {
    const forced = record.method === 'always-select';
    const rows = lexicalPredictions(suite.catalog.assets, suite.prompts, {forceSelection: forced});
    const receipt = evaluate(rows);
    assert.equal(receipt.suite_sha256, measurements.suite_sha256);
    assert.deepEqual(receipt.metrics, record.metrics);
    assert.equal(receipt.predictions_sha256, record.predictions_sha256);
    assert.equal(receipt.verdict, 'below_public_threshold');
  }
});
test('qualification requires eight supported selections and no false selections on abstain', () => {
  const rows = gold();
  rows[0][1] = null;
  rows[1][1] = null;
  assert.equal(evaluate(rows).verdict, 'qualified_on_public_cases');
  rows[2][1] = null;
  assert.equal(evaluate(rows).verdict, 'below_public_threshold');
  const unsafe = gold();
  unsafe.find(pair => pair[1] === null)[1] = suite.catalog.assets[0].id;
  const receipt = evaluate(unsafe);
  assert.equal(receipt.metrics.correct_selection, 10);
  assert.equal(receipt.metrics.false_selection_on_abstain, 1);
  assert.equal(receipt.verdict, 'below_public_threshold');
});
test('raw bytes and canonical predictions are distinct receipt bindings', () => {
  const first = evaluate(baseline);
  const serialized = JSON.stringify(clone(baseline).reverse(), null, 2);
  const reordered = score(serialized, suite);
  assert.equal(first.predictions_sha256, reordered.predictions_sha256);
  assert.notEqual(first.submission_file_sha256, reordered.submission_file_sha256);
  assert.equal(reordered.submission_file_sha256, createHash('sha256').update(serialized).digest('hex'));
  const altered = clone(baseline);
  altered[0][1] = altered[0][1] === null ? suite.catalog.assets[0].id : null;
  assert.notEqual(evaluate(altered).predictions_sha256, first.predictions_sha256);
});
test('an edit to a prompt or rule changes the suite digest', () => {
  const snapshot = {catalog: suite.catalog, prompts: clone(suite.prompts), cases: clone(suite.cases)};
  assert.equal(digest(snapshot), suite.suiteSha256);
  snapshot.prompts[0].intent += ' changed';
  assert.notEqual(digest(snapshot), suite.suiteSha256);
  snapshot.prompts = suite.prompts;
  snapshot.cases.minimum_correct_selections++;
  assert.notEqual(digest(snapshot), suite.suiteSha256);
});
test('missing, extra and duplicate case IDs cannot pass', () => {
  const rows = gold();
  assert.throws(() => evaluate(rows.slice(1)), /Exactly one/);
  assert.throws(() => evaluate([...rows, rows[0]]), /Exactly one/);
  rows[1][0] = rows[0][0];
  assert.throws(() => evaluate(rows), /Duplicate/);
});
test('unknown IDs and non-scalar entries are rejected', () => {
  for (const foreign of ['remote-url', 2, {}, false, []]) {
    const rows = gold();
    rows[0][1] = foreign;
    assert.throws(() => evaluate(rows), /known asset/);
  }
  const rows = gold();
  rows[0][0] = '__proto__';
  assert.throws(() => evaluate(rows), /Unknown case ID/);
});
test('only an array of exact pairs is accepted, including at the JSON boundary', () => {
  for (const candidate of ['{"c01":null,"c01":null}', 'null', '42', '{}']) {
    assert.throws(() => score(candidate, suite), /JSON array/);
  }
  const rows = gold();
  rows[0].push('surplus');
  assert.throws(() => evaluate(rows), /two-element pair/);
  assert.throws(() => score('a'.repeat(65_537), suite), /64 KiB/);
  assert.throws(() => score('process.exit(0)', suite), SyntaxError);
});

test('CLI rejects nonregular inputs and oversized files before buffering', async () => {
  const {mkdtempSync, writeFileSync, rmSync} = await import('node:fs');
  const {spawnSync} = await import('node:child_process');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {fileURLToPath} = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'starlight-spatial-'));
  const cli = fileURLToPath(new URL('verify.mjs', import.meta.url));
  try {
    const file = join(dir, 'too-large.json');
    writeFileSync(file, Buffer.alloc(65_537));
    for (const path of [dir, file]) {
      const run = spawnSync(process.execPath, [cli, 'score', path], {encoding:'utf8', timeout:2000});
      assert.equal(run.status, 1);
      assert.match(run.stderr, /regular file up to 64 KiB/);
    }
    if (process.platform !== 'win32') {
      const fifo = join(dir, 'pipe');
      const mkfifo = spawnSync('mkfifo', [fifo]);
      if (!mkfifo.error && mkfifo.status === 0) {
        const run = spawnSync(process.execPath, [cli, 'score', fifo], {encoding:'utf8', timeout:2000});
        assert.equal(run.status, 1);
        assert.match(run.stderr, /regular file up to 64 KiB/);
      }
    }
  } finally {
    rmSync(dir, {recursive:true, force:true});
  }
});
