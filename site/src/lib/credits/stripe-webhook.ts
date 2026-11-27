/**
 * The Stripe webhook, as a pure function: env, raw body, signature header,
 * store in; status and JSON body out. The route (app/api/stripe/webhook) only
 * reads the request and hands it here.
 *
 * It does one thing: a verified, paid `checkout.session.completed` for a known
 * pack grants that pack's credits to the account in `client_reference_id`,
 * once per Stripe event id. It never refunds, pays out, or calls Stripe.
 *
 * Status codes, chosen for how Stripe retries (any non-2xx is retried for up
 * to three days, then shown as failed in the dashboard):
 *   503  credits off, a secret missing, no durable store, or the store failed.
 *        Retried, so a purchase made during an outage is granted afterwards.
 *   400  bad or stale signature, or a body that is not an event.
 *   422  a paid checkout the server will not grant as sent: unknown pack,
 *        amount or currency mismatch, livemode mismatch, no account id.
 *        Retried and visible, so a config fix plus a resend recovers it.
 *   200  granted, duplicate, an event type we ignore, or an unpaid session
 *        (async payment methods are out of scope; see the architecture doc).
 *
 * Built on SIP — operational tier.
 */
import { creditsEnabled } from "./config";
import { isAccountId, type CreditStore } from "./ledger";
import { CREDIT_PACKS, isPackId, isUsablePack, type CreditPackTable } from "./packs";
import { verifyStripeSignature } from "./stripe-signature";
import { publicNote } from "../desk/public-error";

export const HANDLED_EVENT = "checkout.session.completed";

export interface WebhookInput {
  env: NodeJS.ProcessEnv;
  rawBody: string;
  signature: string | null;
  /** The durable store, or null when none is configured. Never the in-memory one in production. */
  store: CreditStore | null;
  packs?: CreditPackTable;
  nowSeconds?: number;
  /** Tests only. A grant into process memory is a paid purchase lost, so the route never sets this. */
  allowMemoryStore?: boolean;
}

export interface WebhookResult {
  status: 200 | 400 | 422 | 503;
  body: Record<string, unknown>;
}

const reply = (status: WebhookResult["status"], body: Record<string, unknown>): WebhookResult => ({ status, body });

export async function handleStripeWebhook(input: WebhookInput): Promise<WebhookResult> {
  const { env } = input;
  if (!creditsEnabled(env)) return reply(503, { error: "credits are not enabled" });
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) return reply(503, { error: "webhook secret not configured" });
  if (!input.store || (input.store.kind !== "supabase" && !input.allowMemoryStore)) return reply(503, { error: "no durable credit store" });

  const check = verifyStripeSignature(input.rawBody, input.signature, secret, { nowSeconds: input.nowSeconds });
  if (!check.ok) return reply(400, { error: "invalid signature", reason: check.reason });

  let event: unknown;
  try {
    event = JSON.parse(input.rawBody);
  } catch {
    return reply(400, { error: "body is not JSON" });
  }
  if (!isRecord(event) || typeof event.id !== "string" || typeof event.type !== "string") return reply(400, { error: "not a Stripe event" });
  if (event.type !== HANDLED_EVENT) return reply(200, { received: true, ignored: event.type });

  const session = isRecord(event.data) && isRecord(event.data.object) ? event.data.object : null;
  if (!session) return reply(400, { error: "event has no session object" });

  const expectLive = env.CREDITS_STRIPE_LIVEMODE === "true";
  if (event.livemode !== expectLive) return reply(422, { error: "livemode mismatch", eventId: event.id });
  if (session.mode !== "payment" || session.payment_status !== "paid") {
    return reply(200, { received: true, granted: false, reason: "session is not a completed one-time payment" });
  }

  const packs = input.packs ?? CREDIT_PACKS;
  const metadata = isRecord(session.metadata) ? session.metadata : {};
  const packId = metadata.starlight_pack;
  const pack = isPackId(packId) && Object.prototype.hasOwnProperty.call(packs, packId) ? packs[packId] : undefined;
  if (!isPackId(packId) || !isUsablePack(pack)) return reply(422, { error: "unknown credit pack", eventId: event.id });
  if (session.amount_total !== pack.amountTotal || session.currency !== pack.currency) {
    return reply(422, { error: "paid amount does not match the pack", eventId: event.id });
  }
  const accountId = session.client_reference_id;
  if (!isAccountId(accountId)) return reply(422, { error: "checkout has no account id", eventId: event.id });

  try {
    const result = await input.store.grantFromStripeEvent({
      eventId: event.id,
      eventType: event.type,
      accountId,
      credits: pack.credits,
      packId,
      livemode: expectLive,
    });
    return reply(200, { received: true, granted: result.granted, duplicate: result.duplicate });
  } catch (error) {
    return reply(503, { error: "credit store unavailable", note: publicNote(error) });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
