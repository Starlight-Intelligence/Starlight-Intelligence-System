// Reviewer arena scoring and the gate promotion rule. Pure: no I/O, no clock, no Cloudflare imports,
// so the Worker route (GET /v1/arena/scores), the CLI and node --test all use the same arithmetic.

import { BLOCKING_SEVERITIES, FailClosed, SEVERITIES, modelFamily, type Finding } from '../src/review.ts';
import type { Seed } from './seeds.ts';

// One arena case: a seed applied to the base diff (or a clean control, with mutation = null).
export interface Mutation {
  file: string;
  // 1-based line number in the b/ file, read from the hunk header; null if the header was unreadable.
  line: number | null;
  before: string;
  after: string;
  // The text the seed inserted (after minus the common prefix and suffix with before).
  inserted: string;
}

export interface CaseScore {
  caught: boolean;
  falseAlarm: boolean;
  // Highest severity among the findings that counted (seed) or among all findings (clean); null if none.
  severity: string | null;
}

const rank = (s: string) => SEVERITIES.indexOf(s);
const isSevere = (f: Finding) => BLOCKING_SEVERITIES.includes(f.severity);
const maxSeverity = (fs: Finding[]) => (fs.length ? fs.map((f) => f.severity).sort((a, b) => rank(b) - rank(a))[0] : null);
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const base = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;

// A finding names the mutated file if its path equals it, ends with it (or the reverse), or shares
// its basename. Models quote paths from the diff header, but some drop the leading directories.
export function sameFile(findingFile: string, mutatedFile: string): boolean {
  const a = findingFile.trim().replace(/^[ab]\//, '');
  const b = mutatedFile.trim();
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`) || base(a) === base(b);
}

// A finding matches a seed when it is about the mutated file and its summary (or evidence, if a
// future parser keeps one) names the defect: one of the seed keywords, or the inserted code itself.
export function findingMatches(f: Finding & { evidence?: string }, seed: Seed, m: Mutation): boolean {
  if (!sameFile(f.file, m.file)) return false;
  const text = squash(`${f.summary} ${f.evidence ?? ''}`);
  if (seed.keywords.some((k) => text.includes(k.toLowerCase()))) return true;
  const ins = squash(m.inserted);
  return ins.length >= 6 && text.includes(ins);
}

// caught: the model blocked AND at least one high/critical finding matches the seed.
// falseAlarm: on a clean control, any high/critical finding. A model error is neither: it is
// recorded as not caught (a gate model that errors is not catching anything) and no false alarm.
export function scoreCase(seed: Seed, m: Mutation | null, verdict: 'pass' | 'block' | null, findings: Finding[]): CaseScore {
  if (seed.class === 'clean' || m === null) {
    const severe = findings.filter(isSevere);
    return { caught: false, falseAlarm: severe.length > 0, severity: maxSeverity(findings) };
  }
  const hits = findings.filter((f) => isSevere(f) && findingMatches(f, seed, m));
  return { caught: verdict === 'block' && hits.length > 0, falseAlarm: false, severity: maxSeverity(hits) };
}

// ---------- per-model scores (same definition as the arena_scores view) ----------

export interface ArenaRow {
  created_at: number;
  model: string;
  knobs_json: string;
  // Older observations stay visible but have no content-addressed evidence for promotion.
  cohort_sha256?: string | null;
  case_sha256?: string | null;
  seed_id: string;
  seed_class: string;
  base_ref: string;
  caught: number;
  false_alarm: number;
  severity: string | null;
  latency_ms: number;
  tokens_out: number;
  error?: string | null;
}

export interface ModelScore {
  model: string;
  n: number;
  n_seeded: number;
  n_clean: number;
  catch_rate: number | null;
  false_alarm_rate: number | null;
  p50_latency_ms: number | null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function scoreRows(rows: ArenaRow[]): ModelScore[] {
  const by = new Map<string, ArenaRow[]>();
  for (const r of rows) by.set(r.model, [...(by.get(r.model) ?? []), r]);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([model, rs]) => {
    const seeded = rs.filter((r) => r.seed_class !== 'clean');
    const clean = rs.filter((r) => r.seed_class === 'clean');
    return {
      model,
      n: rs.length,
      n_seeded: seeded.length,
      n_clean: clean.length,
      catch_rate: seeded.length ? seeded.reduce((s, r) => s + r.caught, 0) / seeded.length : null,
      false_alarm_rate: clean.length ? clean.reduce((s, r) => s + r.false_alarm, 0) / clean.length : null,
      p50_latency_ms: median(rs.map((r) => r.latency_ms)),
    };
  });
}

// Each effective input contributes once per fixed model and evaluation protocol. Keep the
// adverse outcome on disagreement. A replay cannot hide an outage or improve a case score.
export interface CohortScore {
  model: string;
  cohort_sha256: string;
  knobs_json: string;
  n_seeded: number;
  n_clean: number;
  n_incomplete: number;
  catch_rate: number | null;
  false_alarm_rate: number | null;
}

export function scoreCohorts(rows: ArenaRow[]): CohortScore[] {
  type Unit = { clean: boolean; incomplete: boolean; caught: number; alarm: number };
  const groups = new Map<string, { model: string; cohort_sha256: string; knobs_json: string; units: Map<string, Unit> }>();
  for (const row of rows) {
    const { model, cohort_sha256, case_sha256, knobs_json } = row;
    if (!cohort_sha256 || !case_sha256) continue;
    const key = JSON.stringify([model, cohort_sha256, knobs_json]);
    let group = groups.get(key);
    if (!group) {
      group = { model, cohort_sha256, knobs_json, units: new Map() };
      groups.set(key, group);
    }
    const clean = row.seed_class === 'clean';
    const unit = group.units.get(case_sha256);
    if (unit) {
      unit.incomplete ||= row.error != null || unit.clean !== clean;
      unit.caught = Math.min(unit.caught, row.caught);
      unit.alarm = Math.max(unit.alarm, row.false_alarm);
    } else {
      group.units.set(case_sha256, { clean, incomplete: row.error != null, caught: row.caught, alarm: row.false_alarm });
    }
  }
  return [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, group]) => {
    const { units, ...identity } = group;
    let seeded = 0, clean = 0, incomplete = 0, caught = 0, alarms = 0;
    for (const u of units.values()) {
      if (u.incomplete) incomplete++;
      else if (u.clean) { clean++; alarms += u.alarm; }
      else { seeded++; caught += u.caught; }
    }
    return { ...identity, n_seeded: seeded, n_clean: clean, n_incomplete: incomplete,
      catch_rate: seeded ? caught / seeded : null, false_alarm_rate: clean ? alarms / clean : null };
  });
}

// ---------- promotion rule: recommends, never writes config ----------

export interface Thresholds { minCatch: number; maxFalseAlarm: number; minN: number; minClean: number }
export const DEFAULT_THRESHOLDS: Thresholds = { minCatch: 0.9, maxFalseAlarm: 0.1, minN: 20, minClean: 29 };

export interface ArenaEnv {
  STARLIGHT_ARENA_MIN_CATCH?: string;
  STARLIGHT_ARENA_MAX_FALSE_ALARM?: string;
  STARLIGHT_ARENA_MIN_N?: string;
  STARLIGHT_ARENA_MIN_CLEAN?: string;
}

export function readThresholds(env: ArenaEnv = {}): Thresholds {
  const rate = (v: string | undefined, d: number, name: string) => {
    if (v === undefined || v.trim() === '') return d;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new FailClosed(`${name} must be a number between 0 and 1`);
    return n;
  };
  const count = (v: string | undefined, d: number, name: string) => {
    if (v === undefined || v.trim() === '') return d;
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n <= 0) throw new FailClosed(`${name} must be a positive integer`);
    return n;
  };
  return {
    minCatch: rate(env.STARLIGHT_ARENA_MIN_CATCH, DEFAULT_THRESHOLDS.minCatch, 'STARLIGHT_ARENA_MIN_CATCH'),
    maxFalseAlarm: rate(env.STARLIGHT_ARENA_MAX_FALSE_ALARM, DEFAULT_THRESHOLDS.maxFalseAlarm, 'STARLIGHT_ARENA_MAX_FALSE_ALARM'),
    minN: count(env.STARLIGHT_ARENA_MIN_N, DEFAULT_THRESHOLDS.minN, 'STARLIGHT_ARENA_MIN_N'),
    minClean: count(env.STARLIGHT_ARENA_MIN_CLEAN, DEFAULT_THRESHOLDS.minClean, 'STARLIGHT_ARENA_MIN_CLEAN'),
  };
}

export interface Recommendation {
  thresholds: Thresholds;
  recommended: string[];
  models: { model: string; cohort_sha256: string | null; knobs_json: string | null; qualifies: boolean; reasons: string[] }[];
  note: string;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// A model qualifies when it has at least minN seeded cases, a catch rate >= minCatch, at least one
// clean cohort meeting minClean and maxFalseAlarm, and the gate itself would accept it
// (a known reviewer family, not a Claude/Anthropic model). Every miss is listed as a reason.
export function recommendGateModels(scores: (CohortScore | ModelScore)[], thresholds: Partial<Thresholds> = {}): Recommendation {
  const t: Thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const cohortsPerModel = new Map<string, number>();
  const models = scores.map((s) => {
    cohortsPerModel.set(s.model, (cohortsPerModel.get(s.model) ?? 0) + 1);
    const reasons: string[] = [];
    const cohort = 'cohort_sha256' in s ? s : null;
    if (!cohort) reasons.push('raw observations lack validated case and cohort identities');
    if (cohort?.n_incomplete) reasons.push(`${cohort.n_incomplete} incomplete or inconsistently labelled case(s)`);
    if (s.n_clean < t.minClean) reasons.push(`only ${s.n_clean} completed clean case(s); needs at least ${t.minClean}`);
    if (s.n_seeded < t.minN) reasons.push(`only ${s.n_seeded} seeded case(s); needs at least ${t.minN}`);
    if (s.catch_rate === null) reasons.push('no seeded cases, so no catch rate');
    else if (s.catch_rate < t.minCatch) reasons.push(`catch rate ${pct(s.catch_rate)} is below ${pct(t.minCatch)}`);
    if (s.false_alarm_rate === null) reasons.push('no clean controls, so the false-alarm rate is unknown');
    else if (s.false_alarm_rate > t.maxFalseAlarm) reasons.push(`false-alarm rate ${pct(s.false_alarm_rate)} is above ${pct(t.maxFalseAlarm)}`);
    try { modelFamily(s.model); } catch (e) { reasons.push(`the gate would refuse it: ${(e as Error).message}`); }
    const qualifies = reasons.length === 0;
    if (qualifies) reasons.push(`catch ${pct(s.catch_rate as number)} over ${s.n_seeded} seeded, false alarms ${pct(s.false_alarm_rate as number)} over ${s.n_clean} clean`);
    return { model: s.model, cohort_sha256: cohort?.cohort_sha256 ?? null, knobs_json: cohort?.knobs_json ?? null, qualifies, reasons };
  });
  return {
    thresholds: t,
    // A model-only configuration cannot select among protocols. Return model-wide names
    // only when unambiguous; the models array always identifies qualifying configurations.
    recommended: models.filter((m) => m.qualifies && cohortsPerModel.get(m.model) === 1).map((m) => m.model),
    models,
    note: 'Recommendation only. Nothing here changes STARLIGHT_GATE_MODELS; a human edits wrangler.jsonc after reading these numbers.',
  };
}
