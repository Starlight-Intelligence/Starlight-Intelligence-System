/**
 * The credits ledger in Supabase, over PostgREST RPC with `fetch` and nothing else.
 *
 * Every mutation is one call to a SECURITY DEFINER function in
 * supabase/migrations/*_credits_ledger.sql, so the balance check and the
 * ledger write happen in one transaction under a row lock. This client only
 * validates inputs, sends them, and checks the answer's shape; it never
 * computes a balance itself.
 *
 * The service-role key bypasses RLS. It is read on the server only and must
 * never reach a browser bundle (no NEXT_PUBLIC_ prefix).
 *
 * Built on SIP — operational tier.
 */
import {
  assertAccountId,
  assertCredits,
  assertIdempotencyKey,
  CreditStoreError,
  validateGrant,
  type CreditStore,
} from "./ledger";

export const DEFAULT_TIMEOUT_MS = 5_000;

export interface SupabaseRestConfig {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or null. */
export function supabaseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SupabaseRestConfig | null {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || !/^https:\/\//.test(url)) return null;
  return { url: url.replace(/\/+$/, ""), serviceRoleKey: key };
}

export function supabaseCreditStore(config: SupabaseRestConfig): CreditStore {
  const call = (fn: string, args: Record<string, unknown>) => rpc(config, fn, args);
  return {
    kind: "supabase",
    async balance(accountId) {
      assertAccountId(accountId);
      return credits(await call("get_credit_balance", { p_user_id: accountId }), "balance");
    },
    async reserve({ accountId, amount, idempotencyKey }) {
      assertAccountId(accountId);
      assertCredits(amount, "a reservation");
      assertIdempotencyKey(idempotencyKey);
      const row = object(await call("reserve_credits", { p_user_id: accountId, p_amount: amount, p_idempotency_key: idempotencyKey }));
      const balance = credits(row.balance, "balance");
      if (row.ok === true) {
        if (typeof row.reservation_id !== "string" || !row.reservation_id) throw new CreditStoreError("reserve_credits answered without a reservation id");
        return { ok: true, reservationId: row.reservation_id, amount: credits(row.amount, "amount"), balance };
      }
      if (row.ok === false) return { ok: false, reservationId: null, amount, balance };
      throw new CreditStoreError("reserve_credits answered with an unexpected shape");
    },
    async commit(reservationId, actual) {
      assertCredits(actual, "the actual spend", true);
      const row = object(await call("commit_reservation", { p_reservation_id: reservationId, p_actual: actual }));
      return { charged: credits(row.charged, "charged"), refunded: credits(row.refunded, "refunded"), balance: credits(row.balance, "balance") };
    },
    async release(reservationId) {
      const row = object(await call("release_reservation", { p_reservation_id: reservationId }));
      return { released: credits(row.released, "released"), balance: credits(row.balance, "balance") };
    },
    async grantFromStripeEvent(grant) {
      validateGrant(grant);
      const row = object(
        await call("grant_from_stripe_event", {
          p_event_id: grant.eventId,
          p_event_type: grant.eventType,
          p_user_id: grant.accountId,
          p_credits: grant.credits,
          p_pack_id: grant.packId,
          p_livemode: grant.livemode,
        }),
      );
      if (typeof row.granted !== "boolean" || typeof row.duplicate !== "boolean") {
        throw new CreditStoreError("grant_from_stripe_event answered with an unexpected shape");
      }
      return { granted: row.granted, duplicate: row.duplicate, balance: credits(row.balance, "balance") };
    },
  };
}

async function rpc(config: SupabaseRestConfig, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${config.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(args),
      signal: controller.signal,
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      // PostgREST puts the raised exception text in `message`. It is ours
      // (fixed strings in the migration), but it stays in the server log only.
      const message = payload && typeof payload === "object" ? (payload as { message?: unknown }).message : undefined;
      throw new CreditStoreError(`${fn} answered ${response.status}${typeof message === "string" ? `: ${message.slice(0, 200)}` : ""}`);
    }
    if (payload === undefined) throw new CreditStoreError(`${fn} answered with no JSON`);
    return payload;
  } catch (error) {
    if (error instanceof CreditStoreError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new CreditStoreError(`${fn} did not answer within ${timeoutMs} ms`);
    throw new CreditStoreError(`${fn} failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CreditStoreError("the credit store answered with something that is not an object");
  return value as Record<string, unknown>;
}

function credits(value: unknown, label: string): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CreditStoreError(`the credit store answered with an invalid ${label}`);
  }
  return parsed;
}
