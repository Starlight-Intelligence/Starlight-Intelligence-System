/**
 * Stripe webhook endpoint for credit purchases. Disabled unless
 * CREDITS_ENABLED=true and STRIPE_WEBHOOK_SECRET, SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are all set; otherwise every request gets 503.
 * All decisions live in lib/credits/stripe-webhook.ts.
 *
 * Built on SIP — operational tier.
 */
import { NextResponse } from "next/server";
import { creditsEnabled } from "@/lib/credits/config";
import { verifyStripeSignature } from "@/lib/credits/stripe-signature";
import { supabaseConfigFromEnv, supabaseCreditStore } from "@/lib/credits/supabase-store";
import { handleStripeWebhook } from "@/lib/credits/stripe-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Larger than any checkout.session.completed event; refuses oversized bodies before hashing them. */
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "body too large" }, { status: 413 });
  }
  // The signature covers the exact bytes Stripe sent, so read text, never JSON.
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "body too large" }, { status: 413 });
  }
  if (!creditsEnabled(process.env)) {
    return NextResponse.json({ error: "credits are disabled" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "stripe webhook secret is not configured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const signature = request.headers.get("stripe-signature");
  const sig = verifyStripeSignature(rawBody, signature, webhookSecret);
  if (!sig.ok) {
    console.warn("stripe webhook refused", 401, JSON.stringify({ error: sig.reason }));
    return NextResponse.json({ error: sig.reason }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const config = supabaseConfigFromEnv(process.env);
  const result = await handleStripeWebhook({
    env: process.env,
    rawBody,
    signature,
    store: config ? supabaseCreditStore(config) : null,
  });
  if (result.status !== 200) {
    // Event id and reason only; never the body, which carries customer details.
    console.warn("stripe webhook refused", result.status, JSON.stringify(result.body));
  }
  return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
