import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { score } from './score.mjs';
const sha = text => createHash('sha256').update(text).digest('hex');
function packet() {
  const run = (brief, minutes) => ({ brief, minutes, artifactDigest: sha(brief),
    reviewedDigest: sha(brief), result: 'accept', founderHelp: false });
  return { version: 1, mode: 'fixture', methodDigest: sha('method-v1'), author: 'a',
    pairs: [{ builder: 'b', reviewer: 'c', order: 'baseline-first', baseline: run('a1', 18), method: run('a2', 12) }] };
}
test('paired acceptance retains fixture label and time difference', () => {
  const s = score(packet()); assert.equal(s.mode, 'fixture'); assert.equal(s.pairedAccepts, 1);
  assert.equal(s.meanMinutesSavedOnPairedAccepts, 6);
});
test('founder intervention counts as an attempt and loses independent credit', () => {
  const p = packet(); p.pairs[0].method.founderHelp = true;
  const s = score(p); assert.equal(s.pairs, 1); assert.equal(s.baselineOnly, 1); assert.equal(s.founderAssists.method, 1); assert.equal(s.meanMinutesSavedOnPairedAccepts, null);
});
test('rejected work and abandonment remain in the denominator', () => {
  const p = packet(); const pair = p.pairs[0]; pair.method.result = 'reject';
  Object.assign(pair.baseline, { result: 'abandon', artifactDigest: null, reviewedDigest: null });
  const s = score(p); assert.equal(s.pairs, 1); assert.equal(s.methodAccepted + s.baselineAccepted, 0); assert.equal(s.abandoned.baseline, 1);
});
for (const [label, mutate] of [
  ['wrong reviewed version', p => { p.pairs[0].method.reviewedDigest = sha('wrong'); }],
  ['same reviewer and builder', p => { p.pairs[0].reviewer = p.pairs[0].builder; }],
  ['author acting as builder', p => { p.pairs[0].builder = p.author; }],
  ['same brief', p => { p.pairs[0].method.brief = p.pairs[0].baseline.brief; }],
  ['same output counted twice', p => { Object.assign(p.pairs[0].method, {artifactDigest:sha('a1'),reviewedDigest:sha('a1')}); }],
  ['duplicate builder', p => { p.pairs.push(p.pairs[0]); }],
  ['raw conversation field', p => { p.pairs[0].method.transcript = 'omit'; }]
]) test(label, () => { const p = packet(); mutate(p); assert.throws(() => score(p)); });
