/**
 * The browser side of POST /api/desk/run: the response types, one fetch, and
 * the mapping from an HTTP status to something a page can say.
 *
 * Shared by the Desk console and the homepage's Ask Starlight panel, so both
 * read the same contract. Free of server imports (the cascade pulls in
 * node:crypto), so it is safe in a client bundle and testable without one.
 *
 * Built on SIP — operational tier.
 */
import type { CostGap } from "./cost-copy";

export interface DeskStage {
  name: string;
  status: "ok" | "failed" | "skipped";
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  costEur?: number;
  latencyMs?: number;
  note?: string;
}

export interface DeskReceipt {
  receiptId: string;
  verdict: "PASS" | "FAIL" | "PARTIAL";
  stages: DeskStage[];
  totals: { costEur: number; latencyMs: number; tokens: { input: number; output: number } };
  subject: { name: string; digest: { sha256: string } };
}

export interface DeskSource {
  index: number;
  title: string;
  url: string;
}

/** A verified claim. Its index is the `[n]` marker the brief carries. */
export interface DeskClaim {
  index: number;
  quote: string;
  url: string;
}

export interface DeskBelief {
  id: string;
  question: string;
  claim: string;
  url: string;
  at: string;
}

export interface DeskContradiction {
  priorId: string;
  priorClaim: string;
  newClaim: string;
  reason: string;
}

export interface DeskResponse {
  question: string;
  brief: string;
  sources: DeskSource[];
  claims?: DeskClaim[];
  judgement: { score: number; rationale: string } | null;
  groundingRate: number;
  related: DeskBelief[];
  contradictions: DeskContradiction[];
  remembered: number;
  receipt: DeskReceipt;
  signed: boolean;
  unsignedReason: string | null;
  pricesVerified: boolean;
  costComplete: boolean;
  unpricedStages: string[];
  unaccounted?: CostGap[];
  /** True when the receipt is not signed. */
  draft?: boolean;
  /** "total", or "priced-stage subtotal" when the run is cost-incomplete. */
  costEurMeaning?: string;
}

/**
 * What went wrong, in the terms a page needs:
 *   limit       429, a per-address, run, or token ceiling; retryAfter in seconds when sent
 *   offline     503, the Desk is not configured or cannot reach its counter; nothing ran
 *   invalid     400 or 422, the question itself was refused
 *   failed      anything else the server answered, including 502
 *   unreachable the request never got an answer
 */
export type DeskFailureKind = "limit" | "offline" | "invalid" | "failed" | "unreachable";

export type DeskOutcome =
  | { ok: true; data: DeskResponse }
  | { ok: false; kind: DeskFailureKind; status: number | null; error: string; retryAfter: number | null };

export function failureKind(status: number): DeskFailureKind {
  if (status === 429) return "limit";
  if (status === 503) return "offline";
  if (status === 400 || status === 422) return "invalid";
  return "failed";
}

/** The retry-after header in whole seconds, or null when absent or not a number of seconds. */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

/** "about 40 seconds", "about 3 minutes", "about 5 hours": a wait a person can read. */
export function waitPhrase(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(1, seconds)} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(seconds / 3600);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Turn one HTTP answer into an outcome. The error text is the server's own
 * when it sent one (the route's messages are written for people), else
 * "The Desk answered <status>."
 */
export function outcomeFromResponse(status: number, retryAfterHeader: string | null, payload: unknown): DeskOutcome {
  const ok = status >= 200 && status < 300;
  if (ok && payload && typeof payload === "object") return { ok: true, data: payload as DeskResponse };
  const detail =
    payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : `The Desk answered ${status}.`;
  return {
    ok: false,
    kind: ok ? "failed" : failureKind(status),
    status,
    error: detail,
    retryAfter: parseRetryAfter(retryAfterHeader),
  };
}

/** One run. Never throws: a network failure comes back as kind "unreachable". */
export async function askDesk(question: string, fetchImpl: typeof fetch = fetch): Promise<DeskOutcome> {
  let response: Response;
  try {
    response = await fetchImpl("/api/desk/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
  } catch {
    return {
      ok: false,
      kind: "unreachable",
      status: null,
      error: "The Desk could not be reached. Check your connection and try again.",
      retryAfter: null,
    };
  }
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const payload: unknown = isJson ? await response.json().catch(() => null) : null;
  return outcomeFromResponse(response.status, response.headers.get("retry-after"), payload);
}
