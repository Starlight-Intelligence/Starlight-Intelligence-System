/**
 * Stripe webhook signature verification, by hand, per Stripe's documented scheme.
 *
 * Stripe signs `${timestamp}.${rawBody}` with HMAC-SHA256 under the endpoint's
 * signing secret (the whole `whsec_…` string is the key) and sends
 * `Stripe-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>…]`. During a secret
 * roll there may be several v1 values; any one matching is enough. Other
 * schemes (v0 is test-only) are ignored.
 *
 * The `stripe` SDK is not needed for this one check: node:crypto has HMAC and
 * a constant-time compare, and the route makes no outbound Stripe calls.
 *
 * https://docs.stripe.com/webhooks#verify-manually
 *
 * Built on SIP — operational tier.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe's own libraries default to five minutes. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: SignatureFailure };

export type SignatureFailure = "missing header" | "malformed header" | "no v1 signature" | "timestamp outside tolerance" | "signature mismatch" | "missing secret";

export interface VerifyOptions {
  /** Seconds since the epoch. Tests inject one. */
  nowSeconds?: number;
  toleranceSeconds?: number;
}

export function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") {
      if (!/^\d{1,12}$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) {
      signatures.push(value.toLowerCase());
    }
  }
  return timestamp === null ? null : { timestamp, signatures };
}

export function signPayload(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

/**
 * Verify the raw request body exactly as received. Re-serialized JSON will not
 * match; the route must read `request.text()`, never `request.json()`, first.
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, options: VerifyOptions = {}): SignatureCheck {
  if (!secret) return { ok: false, reason: "missing secret" };
  if (!header) return { ok: false, reason: "missing header" };
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "malformed header" };
  if (parsed.signatures.length === 0) return { ok: false, reason: "no v1 signature" };
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  // Stale events are replays; events from the future are a skewed or forged clock. Refuse both.
  if (Math.abs(now - parsed.timestamp) > tolerance) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = Buffer.from(signPayload(secret, parsed.timestamp, rawBody), "hex");
  let matched = false;
  for (const signature of parsed.signatures) {
    const candidate = Buffer.from(signature, "hex");
    // Every candidate is compared, so timing does not reveal which one matched.
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) matched = true;
  }
  return matched ? { ok: true, timestamp: parsed.timestamp } : { ok: false, reason: "signature mismatch" };
}
