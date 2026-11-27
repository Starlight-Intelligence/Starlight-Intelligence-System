/**
 * The Desk's question limit, in a module with no server dependencies.
 *
 * The cascade imports node:crypto, so a client component must not import it.
 * The cascade re-exports this constant, so the route, the cascade, and every
 * page that asks a question enforce the same number.
 *
 * Built on SIP — operational tier.
 */

/** The longest question the Desk takes. The route and runDesk both enforce it. */
export const MAX_QUESTION_CHARS = 400;
