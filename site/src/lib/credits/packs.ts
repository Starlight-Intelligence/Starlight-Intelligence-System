/**
 * Which Stripe purchase grants how many credits. Server-side only.
 *
 * A checkout grants credits only when its session names a pack here (through
 * `metadata.starlight_pack`, set on the Payment Link or Checkout Session in
 * the Stripe dashboard, never by the buyer) and its paid total and currency
 * match the pack exactly. The client never states an amount the server trusts.
 *
 * Empty on purpose, like the null prices in desk/pricing.ts: until Frank adds
 * a pack in a reviewed change, no checkout grants anything. A paid checkout
 * naming an unknown pack is answered 422, so Stripe keeps retrying it and it
 * stays visible as a failed delivery until the pack exists and it is resent.
 *
 * Built on SIP — operational tier.
 */

export interface CreditPack {
  /** Whole credits granted for one purchase. */
  credits: number;
  /** The exact paid total, in the currency's minor unit (cents). */
  amountTotal: number;
  /** Lowercase ISO currency code, as Stripe sends it. */
  currency: string;
  /** Who added the pack and when, for the review trail. */
  approvedBy: string;
  approvedAt: string;
}

export type CreditPackTable = Readonly<Record<string, CreditPack>>;

/**
 * Example of an entry (do not uncomment without Frank's approval):
 *   "starter-1000": { credits: 1000, amountTotal: 1000, currency: "eur", approvedBy: "frank", approvedAt: "YYYY-MM-DD" },
 */
export const CREDIT_PACKS: CreditPackTable = Object.freeze({});

const PACK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isPackId(value: unknown): value is string {
  return typeof value === "string" && PACK_ID.test(value);
}

/** A pack is usable when every field is well-formed. A malformed pack grants nothing. */
export function isUsablePack(pack: CreditPack | undefined): pack is CreditPack {
  return Boolean(
    pack &&
      Number.isSafeInteger(pack.credits) &&
      pack.credits > 0 &&
      Number.isSafeInteger(pack.amountTotal) &&
      pack.amountTotal > 0 &&
      /^[a-z]{3}$/.test(pack.currency) &&
      pack.approvedBy.length > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(pack.approvedAt),
  );
}
