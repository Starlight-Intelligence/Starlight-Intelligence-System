import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
function requireValue(ok, message) {
  if (!ok) throw new Error(message);
}
function exact(obj, fields) {
  requireValue(obj && typeof obj === 'object' && !Array.isArray(obj)
    && Object.keys(obj).length === fields.length && fields.every(f => Object.hasOwn(obj, f)),
  'Invalid fields in pilot packet');
}

export function score(packet) {
  exact(packet, ['version', 'mode', 'methodDigest', 'author', 'pairs']);
  requireValue(packet.version === 1 && ['fixture', 'observed'].includes(packet.mode)
    && digest(packet.methodDigest) && id(packet.author) && Array.isArray(packet.pairs), 'Invalid pilot header');
  const builders = new Set();
  const artifacts = new Set();
  const totals = { pairs: 0, baselineAccepted: 0, methodAccepted: 0, methodOnly: 0, baselineOnly: 0,
    founderAssists: { baseline: 0, method: 0 }, abandoned: { baseline: 0, method: 0 },
    minutesSavedAcrossPairedAccepts: 0, pairedAccepts: 0 };
  for (const pair of packet.pairs) {
    exact(pair, ['builder', 'reviewer', 'order', 'baseline', 'method']);
    requireValue(id(pair.builder) && id(pair.reviewer) && !builders.has(pair.builder)
      && new Set([packet.author, pair.builder, pair.reviewer]).size === 3, 'Duplicate builder or non-independent review');
    requireValue(['baseline-first', 'method-first'].includes(pair.order), 'Invalid run order');
    requireValue(pair.baseline?.brief !== pair.method?.brief, 'Use distinct matched briefs');
    builders.add(pair.builder);
    for (const arm of ['baseline', 'method']) {
      const run = pair[arm];
      exact(run, ['brief', 'artifactDigest', 'reviewedDigest', 'result', 'minutes', 'founderHelp']);
      requireValue(id(run.brief) && ['accept', 'reject', 'abandon'].includes(run.result)
        && count(run.minutes) && typeof run.founderHelp === 'boolean', 'Invalid run');
      totals.founderAssists[arm] += Number(run.founderHelp);
      totals.abandoned[arm] += Number(run.result === 'abandon');
      if (run.result === 'abandon') {
        requireValue(run.artifactDigest === null && run.reviewedDigest === null, 'Abandonment records no submitted artifact');
      } else {
        requireValue(digest(run.artifactDigest) && run.artifactDigest === run.reviewedDigest
          && !artifacts.has(run.artifactDigest), 'Invalid, repeated, or unreviewed artifact version');
        artifacts.add(run.artifactDigest);
      }
    }
    const accepted = run => run.result === 'accept' && !run.founderHelp;
    const baseline = accepted(pair.baseline);
    const method = accepted(pair.method);
    totals.pairs++;
    totals.baselineAccepted += Number(baseline);
    totals.methodAccepted += Number(method);
    totals.methodOnly += Number(method && !baseline);
    totals.baselineOnly += Number(baseline && !method);
    if (baseline && method) {
      totals.pairedAccepts++;
      totals.minutesSavedAcrossPairedAccepts += pair.baseline.minutes - pair.method.minutes;
    }
  }
  return { mode: packet.mode, ...totals,
    meanMinutesSavedOnPairedAccepts: totals.pairedAccepts
      ? totals.minutesSavedAcrossPairedAccepts / totals.pairedAccepts : null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node score.mjs <private-packet.json>');
    const packet = JSON.parse(await readFile(process.argv[2], 'utf8'));
    console.log(JSON.stringify(score(packet), null, 2));
  } catch (error) {
    console.error(error instanceof SyntaxError ? 'Invalid JSON' : error.message);
    process.exitCode = 1;
  }
}
