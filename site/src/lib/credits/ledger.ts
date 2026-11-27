/**
 * The credits ledger: the interface, the shared rules, and an in-memory
 * implementation that mirrors the Supabase functions line for line.
 *
 * A credit is a whole number. An account's balance is the sum of its ledger
 * entries and never falls below zero. Spending follows the Desk token meter's
 * shape (run-limit.ts): reserve the worst case before paid work, then commit
 * the actual amount (the rest goes back) or release the whole hold. Credits
 * enter only through a verified Stripe event, once per event id.
 *
 * Nothing here moves money. A grant records credits someone already paid for;
 * there is no refund, payout, or transfer operation, by design.
 *
 * The in-memory store is for tests and local development. A deployment uses
 * the Supabase store (supabase-store.ts), where the same rules run inside
 * SECURITY DEFINER functions in one transaction each.
 *
 * Built on SIP — operational tier.
 */
import { randomUUID } from "node:crypto";
import { PublicError } from "../desk/public-error";

export type CreditStoreKind = "memory" | "supabase";

export interface ReserveRequest {
  accountId: string;
  /** Whole credits to hold: the run's worst case. */
  amount: number;
  /** Repeating a key returns the reservation it already made, never a second hold. */
  idempotencyKey: string;
}

export type ReserveResult =
  | { ok: true; reservationId: string; amount: number; balance: number }
  | { ok: false; reservationId: null; amount: number; balance: number };

export interface CommitResult {
  /** Credits the run actually spent. */
  charged: number;
  /** Credits returned to the account from the hold. */
  refunded: number;
  balance: number;
}

export interface ReleaseResult {
  released: number;
  balance: number;
}

export interface StripeGrant {
  /** Stripe's event id (evt_…). The idempotency key for the grant. */
  eventId: string;
  eventType: string;
  accountId: string;
  credits: number;
  /** The server-side pack id the credits came from. */
  packId: string;
  livemode: boolean;
}

export interface GrantResult {
  granted: boolean;
  /** True when this event id was already processed; nothing changed. */
  duplicate: boolean;
  balance: number;
}

export interface CreditStore {
  readonly kind: CreditStoreKind;
  balance(accountId: string): Promise<number>;
  /** Hold credits atomically, or refuse without changing the balance. */
  reserve(request: ReserveRequest): Promise<ReserveResult>;
  /** Settle a hold at `actual` (at most the amount held). Throws when the hold is unknown or already settled differently. */
  commit(reservationId: string, actual: number): Promise<CommitResult>;
  /** Return a whole hold. Releasing an already released hold changes nothing. */
  release(reservationId: string): Promise<ReleaseResult>;
  /** Add paid-for credits once per Stripe event id. */
  grantFromStripeEvent(grant: StripeGrant): Promise<GrantResult>;
}

/** Any store failure: unreachable, refused, or an answer of the wrong shape. Callers fail closed on it. */
export class CreditStoreError extends PublicError {
  constructor(message: string) {
    super(message, "credit store unavailable");
    this.name = "CreditStoreError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const STRIPE_EVENT_ID = /^evt_[A-Za-z0-9]{8,255}$/;

export function isAccountId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function assertAccountId(value: string): void {
  if (!isAccountId(value)) throw new CreditStoreError("credits need an account id that is a uuid");
}

/** A positive whole number of credits that stays exact in JSON and in Postgres bigint. */
export function assertCredits(value: number, label = "credits", allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new CreditStoreError(`${label} must be a ${allowZero ? "non-negative" : "positive"} whole number`);
  }
}

export function assertIdempotencyKey(value: string): void {
  if (!IDEMPOTENCY_KEY.test(value)) throw new CreditStoreError("an idempotency key is 8 to 128 safe characters");
}

export function assertStripeEventId(value: string): void {
  if (!STRIPE_EVENT_ID.test(value)) throw new CreditStoreError("a grant needs a Stripe event id");
}

export function validateGrant(grant: StripeGrant): void {
  assertStripeEventId(grant.eventId);
  assertAccountId(grant.accountId);
  assertCredits(grant.credits);
  if (!grant.packId || grant.packId.length > 64) throw new CreditStoreError("a grant needs a pack id");
}

interface MemoryReservation {
  accountId: string;
  amount: number;
  status: "open" | "committed" | "released";
  charged: number;
}

export interface MemoryLedgerEntry {
  accountId: string;
  kind: "grant" | "reserve" | "reservation_refund";
  amount: number;
  balanceAfter: number;
  reservationId: string | null;
  stripeEventId: string | null;
}

export interface MemoryStoreOptions {
  /** The database kill switch, mirrored. Off refuses new holds and grants; settling stays possible. */
  enabled?: boolean;
  newId?: () => string;
}

/** One process, one ledger. Tests and local development only. */
export function memoryCreditStore(options: MemoryStoreOptions = {}): CreditStore & { readonly ledger: readonly MemoryLedgerEntry[] } {
  const enabled = options.enabled ?? true;
  const newId = options.newId ?? (() => randomUUID());
  const balances = new Map<string, number>();
  const reservations = new Map<string, MemoryReservation>();
  const byKey = new Map<string, string>();
  const events = new Set<string>();
  const ledger: MemoryLedgerEntry[] = [];

  const append = (entry: Omit<MemoryLedgerEntry, "balanceAfter">) => {
    const after = (balances.get(entry.accountId) ?? 0) + entry.amount;
    if (after < 0) throw new CreditStoreError("the ledger refused an entry that would take the balance below zero");
    balances.set(entry.accountId, after);
    ledger.push(Object.freeze({ ...entry, balanceAfter: after }));
    return after;
  };

  return {
    kind: "memory",
    get ledger() {
      return ledger;
    },
    async balance(accountId) {
      assertAccountId(accountId);
      return balances.get(accountId) ?? 0;
    },
    async reserve({ accountId, amount, idempotencyKey }) {
      assertAccountId(accountId);
      assertCredits(amount, "a reservation");
      assertIdempotencyKey(idempotencyKey);
      if (!enabled) throw new CreditStoreError("credits are switched off in the store");
      const existing = byKey.get(`${accountId}|${idempotencyKey}`);
      if (existing) {
        const held = reservations.get(existing)!;
        if (held.amount !== amount) throw new CreditStoreError("that idempotency key already holds a different amount");
        return { ok: true, reservationId: existing, amount: held.amount, balance: balances.get(accountId) ?? 0 };
      }
      const balance = balances.get(accountId) ?? 0;
      if (balance < amount) return { ok: false, reservationId: null, amount, balance };
      const reservationId = newId();
      reservations.set(reservationId, { accountId, amount, status: "open", charged: 0 });
      byKey.set(`${accountId}|${idempotencyKey}`, reservationId);
      const after = append({ accountId, kind: "reserve", amount: -amount, reservationId, stripeEventId: null });
      return { ok: true, reservationId, amount, balance: after };
    },
    async commit(reservationId, actual) {
      assertCredits(actual, "the actual spend", true);
      const held = reservations.get(reservationId);
      if (!held) throw new CreditStoreError("no such reservation");
      if (held.status === "committed" && held.charged === actual) {
        return { charged: actual, refunded: held.amount - actual, balance: balances.get(held.accountId) ?? 0 };
      }
      if (held.status !== "open") throw new CreditStoreError("that reservation is already settled");
      if (actual > held.amount) throw new CreditStoreError("the actual spend exceeds the reservation");
      const refunded = held.amount - actual;
      const balance =
        refunded > 0
          ? append({ accountId: held.accountId, kind: "reservation_refund", amount: refunded, reservationId, stripeEventId: null })
          : balances.get(held.accountId) ?? 0;
      held.status = "committed";
      held.charged = actual;
      return { charged: actual, refunded, balance };
    },
    async release(reservationId) {
      const held = reservations.get(reservationId);
      if (!held) throw new CreditStoreError("no such reservation");
      if (held.status === "released") return { released: held.amount, balance: balances.get(held.accountId) ?? 0 };
      if (held.status !== "open") throw new CreditStoreError("that reservation is already settled");
      const balance = append({ accountId: held.accountId, kind: "reservation_refund", amount: held.amount, reservationId, stripeEventId: null });
      held.status = "released";
      return { released: held.amount, balance };
    },
    async grantFromStripeEvent(grant) {
      validateGrant(grant);
      if (!enabled) throw new CreditStoreError("credits are switched off in the store");
      if (events.has(grant.eventId)) return { granted: false, duplicate: true, balance: balances.get(grant.accountId) ?? 0 };
      events.add(grant.eventId);
      const balance = append({ accountId: grant.accountId, kind: "grant", amount: grant.credits, reservationId: null, stripeEventId: grant.eventId });
      return { granted: true, duplicate: false, balance };
    },
  };
}
