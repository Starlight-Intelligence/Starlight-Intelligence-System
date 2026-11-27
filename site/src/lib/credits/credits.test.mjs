// node --import ./scripts/test/register.mjs --test src/lib/credits/credits.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { creditsEnabled, creditsGate, CREDITS_CLOSED_WITHOUT_STORE } from "./config.ts";
import { CREDITS_UNAVAILABLE, NOT_ENOUGH_CREDITS, reserveRunCredits, settleRunCredits } from "./desk-hook.ts";
import { CreditStoreError, memoryCreditStore } from "./ledger.ts";
import { signPayload, verifyStripeSignature } from "./stripe-signature.ts";
import { handleStripeWebhook } from "./stripe-webhook.ts";
import { supabaseCreditStore } from "./supabase-store.ts";

const USER = "3f0c2a5e-8d1b-4c7a-9e2f-1a2b3c4d5e6f";
const OTHER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const SECRET = "whsec_test_secret_value";
const NOW = 1_790_000_000;
const PACKS = Object.freeze({
  "starter-1000": { credits: 1000, amountTotal: 1000, currency: "eur", approvedBy: "test", approvedAt: "2026-11-27" },
});
const ON = { CREDITS_ENABLED: "true", STRIPE_WEBHOOK_SECRET: SECRET };

function grant(eventId, credits = 100, accountId = USER) {
  return { eventId, eventType: "checkout.session.completed", accountId, credits, packId: "starter-1000", livemode: false };
}

function checkoutEvent(overrides = {}, sessionOverrides = {}) {
  return {
    id: "evt_1TestCheckoutCompleted",
    type: "checkout.session.completed",
    livemode: false,
    ...overrides,
    data: {
      object: {
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        amount_total: 1000,
        currency: "eur",
        client_reference_id: USER,
        metadata: { starlight_pack: "starter-1000" },
        ...sessionOverrides,
      },
    },
  };
}

function signed(event, { secret = SECRET, at = NOW } = {}) {
  const rawBody = JSON.stringify(event);
  return { rawBody, signature: `t=${at},v1=${signPayload(secret, at, rawBody)}` };
}

// --- signature --------------------------------------------------------------

test("a correctly signed body verifies", () => {
  const { rawBody, signature } = signed(checkoutEvent());
  assert.deepEqual(verifyStripeSignature(rawBody, signature, SECRET, { nowSeconds: NOW + 10 }), { ok: true, timestamp: NOW });
});

test("any one matching v1 is enough during a secret roll", () => {
  const { rawBody, signature } = signed(checkoutEvent());
  const header = `t=${NOW},v1=${"0".repeat(64)},${signature.split(",")[1]}`;
  assert.equal(verifyStripeSignature(rawBody, header, SECRET, { nowSeconds: NOW }).ok, true);
});

test("a tampered body, a wrong secret, or a missing v1 is refused", () => {
  const { rawBody, signature } = signed(checkoutEvent());
  const tampered = rawBody.replace('"amount_total":1000', '"amount_total":1');
  assert.deepEqual(verifyStripeSignature(tampered, signature, SECRET, { nowSeconds: NOW }), { ok: false, reason: "signature mismatch" });
  assert.deepEqual(verifyStripeSignature(rawBody, signature, "whsec_other", { nowSeconds: NOW }), { ok: false, reason: "signature mismatch" });
  assert.deepEqual(verifyStripeSignature(rawBody, `t=${NOW}`, SECRET, { nowSeconds: NOW }), { ok: false, reason: "no v1 signature" });
  assert.deepEqual(verifyStripeSignature(rawBody, null, SECRET, { nowSeconds: NOW }), { ok: false, reason: "missing header" });
  assert.deepEqual(verifyStripeSignature(rawBody, "garbage", SECRET, { nowSeconds: NOW }), { ok: false, reason: "malformed header" });
});

test("a stale or future-dated signature is refused even when the HMAC matches", () => {
  const { rawBody, signature } = signed(checkoutEvent());
  assert.deepEqual(verifyStripeSignature(rawBody, signature, SECRET, { nowSeconds: NOW + 301 }), { ok: false, reason: "timestamp outside tolerance" });
  assert.deepEqual(verifyStripeSignature(rawBody, signature, SECRET, { nowSeconds: NOW - 301 }), { ok: false, reason: "timestamp outside tolerance" });
  assert.equal(verifyStripeSignature(rawBody, signature, SECRET, { nowSeconds: NOW + 300 }).ok, true);
});

// --- ledger -----------------------------------------------------------------

test("a grant is idempotent on the Stripe event id", async () => {
  const store = memoryCreditStore();
  assert.deepEqual(await store.grantFromStripeEvent(grant("evt_1AAAAAAAAAAAAAAA", 500)), { granted: true, duplicate: false, balance: 500 });
  assert.deepEqual(await store.grantFromStripeEvent(grant("evt_1AAAAAAAAAAAAAAA", 500)), { granted: false, duplicate: true, balance: 500 });
  assert.equal(await store.balance(USER), 500);
  assert.equal(store.ledger.length, 1);
});

test("a reservation beyond the balance is refused and holds nothing", async () => {
  const store = memoryCreditStore();
  await store.grantFromStripeEvent(grant("evt_1BBBBBBBBBBBBBBB", 100));
  const refused = await store.reserve({ accountId: USER, amount: 101, idempotencyKey: "run-0000001" });
  assert.deepEqual(refused, { ok: false, reservationId: null, amount: 101, balance: 100 });
  assert.equal(await store.balance(USER), 100);
  const none = await store.reserve({ accountId: OTHER, amount: 1, idempotencyKey: "run-0000002" });
  assert.equal(none.ok, false, "an account that never bought anything has nothing to spend");
});

test("commit charges the actual spend and returns the rest; release returns everything", async () => {
  let n = 0;
  const store = memoryCreditStore({ newId: () => `res-${++n}` });
  await store.grantFromStripeEvent(grant("evt_1CCCCCCCCCCCCCCC", 1000));

  const held = await store.reserve({ accountId: USER, amount: 300, idempotencyKey: "run-0000003" });
  assert.deepEqual(held, { ok: true, reservationId: "res-1", amount: 300, balance: 700 });
  assert.deepEqual(await store.commit("res-1", 120), { charged: 120, refunded: 180, balance: 880 });
  assert.deepEqual(await store.commit("res-1", 120), { charged: 120, refunded: 180, balance: 880 }, "the same commit twice is a no-op");
  await assert.rejects(store.commit("res-1", 100), CreditStoreError, "a different settlement of a settled hold is refused");
  await assert.rejects(store.release("res-1"), CreditStoreError);

  const second = await store.reserve({ accountId: USER, amount: 200, idempotencyKey: "run-0000004" });
  assert.equal(second.balance, 680);
  await assert.rejects(store.commit("res-2", 201), /exceeds the reservation/);
  assert.deepEqual(await store.release("res-2"), { released: 200, balance: 880 });
  assert.deepEqual(await store.release("res-2"), { released: 200, balance: 880 }, "releasing twice changes nothing");

  assert.deepEqual(
    store.ledger.map((entry) => [entry.kind, entry.amount, entry.balanceAfter]),
    [
      ["grant", 1000, 1000],
      ["reserve", -300, 700],
      ["reservation_refund", 180, 880],
      ["reserve", -200, 680],
      ["reservation_refund", 200, 880],
    ],
  );
  assert.throws(() => {
    store.ledger[0].amount = 1;
  }, TypeError, "ledger entries are frozen");
});

test("an idempotency key repeats its reservation instead of holding twice", async () => {
  const store = memoryCreditStore();
  await store.grantFromStripeEvent(grant("evt_1DDDDDDDDDDDDDDD", 100));
  const first = await store.reserve({ accountId: USER, amount: 60, idempotencyKey: "run-0000005" });
  const again = await store.reserve({ accountId: USER, amount: 60, idempotencyKey: "run-0000005" });
  assert.equal(again.reservationId, first.reservationId);
  assert.equal(await store.balance(USER), 40);
  await assert.rejects(store.reserve({ accountId: USER, amount: 10, idempotencyKey: "run-0000005" }), /different amount/);
});

test("the store kill switch refuses new holds and grants", async () => {
  const store = memoryCreditStore({ enabled: false });
  await assert.rejects(store.grantFromStripeEvent(grant("evt_1EEEEEEEEEEEEEEE")), /switched off/);
  await assert.rejects(store.reserve({ accountId: USER, amount: 1, idempotencyKey: "run-0000006" }), /switched off/);
});

test("inputs that are not whole credits or not uuids are refused before any call", async () => {
  const store = memoryCreditStore();
  await assert.rejects(store.reserve({ accountId: "not-a-uuid", amount: 1, idempotencyKey: "run-0000007" }), CreditStoreError);
  await assert.rejects(store.reserve({ accountId: USER, amount: 1.5, idempotencyKey: "run-0000007" }), CreditStoreError);
  await assert.rejects(store.reserve({ accountId: USER, amount: -1, idempotencyKey: "run-0000007" }), CreditStoreError);
  await assert.rejects(store.grantFromStripeEvent(grant("not-an-event")), CreditStoreError);
});

// --- feature flag and fail-closed -------------------------------------------

test("credits are off unless CREDITS_ENABLED is exactly true", () => {
  for (const value of [undefined, "", "1", "yes", "TRUE", "true "]) assert.equal(creditsEnabled({ CREDITS_ENABLED: value }), false, String(value));
  assert.equal(creditsEnabled({ CREDITS_ENABLED: "true" }), true);
  assert.deepEqual(creditsGate({}), { mode: "off" });
});

test("credits on, on Vercel, without Supabase: closed", () => {
  assert.deepEqual(creditsGate({ CREDITS_ENABLED: "true", VERCEL: "1" }), { mode: "closed", status: 503, error: CREDITS_CLOSED_WITHOUT_STORE });
  const gate = creditsGate({ CREDITS_ENABLED: "true", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" });
  assert.equal(gate.mode, "on");
  assert.equal(gate.store.kind, "supabase");
});

test("with credits off the Desk hook is a no-op", async () => {
  assert.deepEqual(await reserveRunCredits({ mode: "off" }, USER, 10, "run-0000008"), { ok: true, skipped: true });
  assert.deepEqual(await settleRunCredits({ mode: "off" }, { ok: true, skipped: true }, 5), { settled: false });
});

test("a store that cannot be reached refuses the run (fail closed)", async () => {
  const fetchImpl = async () => {
    throw new Error("ECONNREFUSED");
  };
  const store = supabaseCreditStore({ url: "https://x.supabase.co", serviceRoleKey: "k", fetchImpl });
  const hold = await reserveRunCredits({ mode: "on", store }, USER, 10, "run-0000009");
  assert.deepEqual(hold, { ok: false, status: 503, error: CREDITS_UNAVAILABLE, note: "credit store unavailable" });

  const garbled = supabaseCreditStore({ url: "https://x.supabase.co", serviceRoleKey: "k", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) });
  assert.equal((await reserveRunCredits({ mode: "on", store: garbled }, USER, 10, "run-0000010")).status, 503, "an answer of the wrong shape is a failure too");

  assert.deepEqual(await reserveRunCredits({ mode: "closed", status: 503, error: "x" }, USER, 10, "run-0000011"), { ok: false, status: 503, error: "x" });
});

test("too few credits refuses the run with 402; settling charges at most the hold", async () => {
  const store = memoryCreditStore();
  await store.grantFromStripeEvent(grant("evt_1FFFFFFFFFFFFFFF", 50));
  const gate = { mode: "on", store };
  assert.deepEqual(await reserveRunCredits(gate, USER, 51, "run-0000012"), { ok: false, status: 402, error: NOT_ENOUGH_CREDITS });
  const hold = await reserveRunCredits(gate, USER, 40, "run-0000013");
  assert.equal(hold.ok && !hold.skipped && hold.balance, 10);
  assert.deepEqual(await settleRunCredits(gate, hold, 999), { settled: true });
  assert.equal(await store.balance(USER), 10, "an over-reported actual is capped at the hold");
});

test("the Supabase store calls the RPC functions with the service key and checks the answer", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, reservation_id: "r-1", amount: 5, balance: 95 }) };
  };
  const store = supabaseCreditStore({ url: "https://x.supabase.co", serviceRoleKey: "srk", fetchImpl });
  assert.deepEqual(await store.reserve({ accountId: USER, amount: 5, idempotencyKey: "run-0000014" }), { ok: true, reservationId: "r-1", amount: 5, balance: 95 });
  assert.equal(calls[0].url, "https://x.supabase.co/rest/v1/rpc/reserve_credits");
  assert.equal(calls[0].headers.apikey, "srk");
  assert.equal(calls[0].headers.authorization, "Bearer srk");
  assert.deepEqual(calls[0].body, { p_user_id: USER, p_amount: 5, p_idempotency_key: "run-0000014" });

  const refusing = supabaseCreditStore({
    url: "https://x.supabase.co",
    serviceRoleKey: "srk",
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ message: "credits are switched off" }) }),
  });
  await assert.rejects(refusing.grantFromStripeEvent(grant("evt_1GGGGGGGGGGGGGGG")), /switched off/);
});

// --- webhook ----------------------------------------------------------------

async function webhook(event, { env = ON, store = memoryCreditStore(), signing = {}, packs = PACKS, nowSeconds = NOW } = {}) {
  const { rawBody, signature } = signed(event, signing);
  return { result: await handleStripeWebhook({ env, rawBody, signature, store, packs, nowSeconds, allowMemoryStore: true }), store };
}

test("webhook: 503 when credits are off, the secret is missing, or there is no durable store", async () => {
  assert.equal((await webhook(checkoutEvent(), { env: {} })).result.status, 503);
  assert.equal((await webhook(checkoutEvent(), { env: { CREDITS_ENABLED: "true" } })).result.status, 503);
  assert.equal((await webhook(checkoutEvent(), { store: null })).result.status, 503);
  const { rawBody, signature } = signed(checkoutEvent());
  const noMemory = await handleStripeWebhook({ env: ON, rawBody, signature, store: memoryCreditStore(), packs: PACKS, nowSeconds: NOW });
  assert.equal(noMemory.status, 503, "the route never grants into process memory");
});

test("webhook: a verified paid checkout grants the server-side pack once", async () => {
  const store = memoryCreditStore();
  const first = await webhook(checkoutEvent(), { store });
  assert.deepEqual(first.result, { status: 200, body: { received: true, granted: true, duplicate: false } });
  const replay = await webhook(checkoutEvent(), { store, nowSeconds: NOW + 5 });
  assert.deepEqual(replay.result, { status: 200, body: { received: true, granted: false, duplicate: true } });
  assert.equal(await store.balance(USER), 1000);
});

test("webhook: bad signatures are 400 and grant nothing", async () => {
  const store = memoryCreditStore();
  assert.equal((await webhook(checkoutEvent(), { store, signing: { secret: "whsec_wrong" } })).result.status, 400);
  assert.equal((await webhook(checkoutEvent(), { store, signing: { at: NOW - 3600 } })).result.status, 400);
  assert.equal(await store.balance(USER), 0);
});

test("webhook: client-side amounts and unknown packs never grant", async () => {
  const store = memoryCreditStore();
  const cases = [
    [{}, { amount_total: 1 }],
    [{}, { currency: "usd" }],
    [{}, { metadata: { starlight_pack: "unknown" } }],
    [{}, { metadata: { starlight_pack: "starter-1000", credits: "999999" }, amount_total: 1 }],
    [{}, { client_reference_id: "not-a-uuid" }],
    [{ livemode: true }, {}],
  ];
  for (const [eventOverrides, sessionOverrides] of cases) {
    const { result } = await webhook(checkoutEvent(eventOverrides, sessionOverrides), { store });
    assert.equal(result.status, 422, JSON.stringify(sessionOverrides));
  }
  assert.equal((await webhook(checkoutEvent({}, {}), { store, packs: {} })).result.status, 422, "an empty pack table grants nothing");
  assert.equal(await store.balance(USER), 0);
});

test("webhook: other event types and unpaid sessions are acknowledged without a grant", async () => {
  const store = memoryCreditStore();
  const other = await webhook({ id: "evt_1OtherEventType00", type: "charge.refunded", livemode: false, data: { object: {} } }, { store });
  assert.deepEqual(other.result, { status: 200, body: { received: true, ignored: "charge.refunded" } });
  const unpaid = await webhook(checkoutEvent({}, { payment_status: "unpaid" }), { store });
  assert.equal(unpaid.result.status, 200);
  assert.equal(unpaid.result.body.granted, false);
  assert.equal(await store.balance(USER), 0);
});

test("webhook: a store failure is 503 so Stripe retries the grant", async () => {
  const store = supabaseCreditStore({
    url: "https://x.supabase.co",
    serviceRoleKey: "k",
    fetchImpl: async () => {
      throw new Error("down");
    },
  });
  const { result } = await webhook(checkoutEvent(), { store });
  assert.equal(result.status, 503);
  assert.equal(result.body.note, "credit store unavailable");
});
