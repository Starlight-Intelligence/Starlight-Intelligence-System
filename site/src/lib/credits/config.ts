/**
 * Whether credits are on, and which store holds them.
 *
 * Off by default. Only `CREDITS_ENABLED=true` turns the layer on; anything
 * else (unset, "1", "yes", "TRUE ") leaves the Desk exactly as it is today.
 *
 * When on, the store must be durable on Vercel: a deployment with credits on
 * and no Supabase configured refuses runs (fail closed), the way access.ts
 * refuses runs without a durable run counter. Off Vercel, an in-memory store
 * stands in for local development. The Stripe webhook never uses the
 * in-memory store: a grant written to process memory is a paid purchase lost.
 *
 * Built on SIP — operational tier.
 */
import { memoryCreditStore, type CreditStore } from "./ledger";
import { supabaseConfigFromEnv, supabaseCreditStore } from "./supabase-store";

export const CREDITS_CLOSED_WITHOUT_STORE = "Credits are on, but this deployment has no credit store configured.";

export function creditsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CREDITS_ENABLED === "true";
}

export type CreditsGate =
  | { mode: "off" }
  | { mode: "on"; store: CreditStore }
  | { mode: "closed"; status: 503; error: string };

let localStore: CreditStore | null = null;

export function creditsGate(env: NodeJS.ProcessEnv = process.env): CreditsGate {
  if (!creditsEnabled(env)) return { mode: "off" };
  const config = supabaseConfigFromEnv(env);
  if (config) return { mode: "on", store: supabaseCreditStore(config) };
  if (!env.VERCEL) return { mode: "on", store: (localStore ??= memoryCreditStore()) };
  return { mode: "closed", status: 503, error: CREDITS_CLOSED_WITHOUT_STORE };
}
