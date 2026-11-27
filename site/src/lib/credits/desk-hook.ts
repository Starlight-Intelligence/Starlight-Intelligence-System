/**
 * The optional credits hook for a Desk run. NOT wired into /api/desk/run yet.
 *
 * The shape the route would use, once Frank enables credits and the Desk has
 * signed-in accounts: reserve the run's worst case in credits before any paid
 * work, then settle with the actual spend, or release on failure. It mirrors
 * the token meter (run-limit.ts) and sits beside it, never in place of it.
 *
 *   - Credits off: `{ ok: true, skipped: true }`. The run proceeds exactly as
 *     it does today; nothing is called.
 *   - Credits on, store unreachable or misconfigured: refuse with 503. A run
 *     whose spend cannot be recorded does not start (fail closed).
 *   - Credits on, balance too low: refuse with 402. Nothing is held.
 *
 * Built on SIP — operational tier.
 */
import type { CreditsGate } from "./config";
import { publicNote } from "../desk/public-error";

export const CREDITS_UNAVAILABLE = "The credit ledger is unavailable, so this run did not start.";
export const NOT_ENOUGH_CREDITS = "Not enough credits for this run.";

export type RunCreditHold =
  | { ok: true; skipped: true }
  | { ok: true; skipped: false; reservationId: string; amount: number; balance: number }
  | { ok: false; status: 402 | 503; error: string; note?: string };

export async function reserveRunCredits(
  gate: CreditsGate,
  accountId: string,
  worstCaseCredits: number,
  idempotencyKey: string,
): Promise<RunCreditHold> {
  if (gate.mode === "off") return { ok: true, skipped: true };
  if (gate.mode === "closed") return { ok: false, status: 503, error: gate.error };
  try {
    const held = await gate.store.reserve({ accountId, amount: worstCaseCredits, idempotencyKey });
    if (!held.ok) return { ok: false, status: 402, error: NOT_ENOUGH_CREDITS };
    return { ok: true, skipped: false, reservationId: held.reservationId, amount: held.amount, balance: held.balance };
  } catch (error) {
    return { ok: false, status: 503, error: CREDITS_UNAVAILABLE, note: publicNote(error) };
  }
}

/**
 * Settle after the run. Unknown actual spend (null) charges the whole hold,
 * like an unreconciled token reservation. A failed settlement leaves the hold
 * in place: the conservative outcome for the platform, visible in the ledger.
 */
export async function settleRunCredits(
  gate: CreditsGate,
  hold: RunCreditHold,
  actualCredits: number | null,
): Promise<{ settled: boolean; note?: string }> {
  if (gate.mode !== "on" || !hold.ok || hold.skipped) return { settled: false };
  try {
    await gate.store.commit(hold.reservationId, actualCredits === null ? hold.amount : Math.min(hold.amount, Math.max(0, Math.ceil(actualCredits))));
    return { settled: true };
  } catch (error) {
    return { settled: false, note: publicNote(error) };
  }
}
