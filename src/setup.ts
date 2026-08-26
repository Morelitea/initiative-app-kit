/**
 * The one-time bootstrap page: switching a route on for as long as an operator
 * needs it, and off again afterwards.
 *
 * Most apps that integrate a vendor have a registration at that vendor which
 * cannot be shared — a GitHub App's private key, a Shopify custom app, a Stripe
 * Connect platform. Each deployment needs its own, and the way to create one
 * without a twenty-field form is to let the app post a filled-in registration
 * on the operator's behalf and show them the credentials once.
 *
 * That is a route which creates a vendor account and prints its secrets, so it
 * has to be a thing you can do once and then not be able to do. This module is
 * that switch, and it is here rather than in an app because nothing about the
 * shape is vendor-specific: the vendor decides what is posted and what comes
 * back, and none of it changes who is allowed to ask.
 *
 * ## Three properties worth having, all easy to miss
 *
 * **Off is indistinguishable from absent.** With no token the routes should
 * answer `404`, not `403`. A route that answers differently once a feature is
 * configured tells an unauthenticated caller which deployments are worth coming
 * back to, which is most of the value of scanning for them.
 *
 * **The return leg cannot carry the token.** A vendor sends the operator back
 * with a code and a `state` and nothing else, so the state has to carry the
 * authority itself. {@link SetupGate.mintState} signs one with the token that
 * authorized the outbound trip — no database, verifiable on any replica, and a
 * flow that runs once per deployment does not earn a table.
 *
 * **Rotation is exact.** More than one token may be held, which is what lets a
 * second operator be let in, or a token be replaced, without ending a flow
 * already in progress. A state is signed by whichever token opened it, so
 * removing that token ends the flows *it* authorized and no others.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { isDigits } from "./parse.js";

/**
 * Where an operator switches it on.
 *
 * Deliberately not named for any vendor. Every app doing this needs the same
 * switch, an app is its own process, and one name across all of them is one
 * thing for an operator to learn rather than one per integration.
 */
export const SETUP_TOKEN_VAR = "INITIATIVE_APP_SETUP_TOKEN";

/** How long a signed state stays good. The whole flow is a few minutes. */
export const SETUP_STATE_TTL_SECONDS = 900;

/**
 * Read one or more tokens out of an environment value.
 *
 * Separated by commas or whitespace, because an operator adding a second one is
 * editing a line in a values file and should not have to think about which.
 * Blanks are dropped rather than treated as a token that matches the empty
 * string, which would switch the gate on and let everybody through.
 */
export function parseSetupTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const separators = new Set([",", " ", "\t", "\n", "\r"]);
  const found: string[] = [];
  let current = "";

  const take = () => {
    // Duplicates are collapsed rather than held twice: two copies of one token
    // would make every comparison below run twice for no answer.
    if (current && !found.includes(current)) found.push(current);
    current = "";
  };
  for (const character of raw) {
    if (separators.has(character)) take();
    else current += character;
  }
  take();
  return found;
}

/** Constant-time comparison. A length mismatch is answered without throwing. */
function matches(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf-8");
  const right = Buffer.from(b, "utf-8");
  // `timingSafeEqual` raises on a length mismatch rather than returning false,
  // and the length of a secret is not worth leaking through an exception.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The switch in front of an app's one-time registration routes.
 *
 * Construct one at boot from {@link SETUP_TOKEN_VAR} and keep it; it holds the
 * tokens and nothing else, so there is no state in it to go stale.
 */
export class SetupGate {
  private readonly tokens: string[];
  private readonly ttlSeconds: number;

  constructor(
    options: {
      /** The raw environment value, or a list an app parsed itself. */
      tokens?: string | string[] | null;
      ttlSeconds?: number;
    } = {}
  ) {
    this.tokens = Array.isArray(options.tokens)
      ? options.tokens.filter(Boolean)
      : parseSetupTokens(options.tokens);
    this.ttlSeconds = options.ttlSeconds ?? SETUP_STATE_TTL_SECONDS;
  }

  /** Whether the operator has switched this on at all. */
  get enabled(): boolean {
    return this.tokens.length > 0;
  }

  /**
   * Which held token a caller presented, or null.
   *
   * The token itself comes back rather than a boolean, because the state minted
   * for the trip has to be signed by the one that opened it — that is what
   * makes removing a token end exactly its own flows.
   *
   * Every held token is compared even after one matches, so how long this takes
   * says nothing about which one it was or how many are held.
   */
  authorize(offered: string | null | undefined): string | null {
    if (!offered) return null;
    let found: string | null = null;
    for (const token of this.tokens) {
      if (matches(offered, token)) found = token;
    }
    return found;
  }

  /**
   * A `state` the return route can trust without a database.
   *
   * `token` is what {@link authorize} returned. Signing with it is what ties the
   * flow to the operator who started it: the browser leaves from one replica
   * and comes back to whichever the load balancer picks, and both can check it.
   */
  mintState(token: string, now: number = Date.now()): string {
    if (!this.tokens.includes(token)) {
      throw new Error("that token is not one this gate holds");
    }
    const expiry = Math.floor(now / 1000) + this.ttlSeconds;
    const nonce = randomBytes(16).toString("base64url");
    const body = `${expiry}.${nonce}`;
    return `${body}.${createHmac("sha256", token).update(body).digest("base64url")}`;
  }

  /**
   * Whether this gate minted that state, under a token it still holds.
   *
   * Checked against every held token, so a state opened under one that has
   * since been removed stops verifying while the others carry on.
   */
  verifyState(state: string | null | undefined, now: number = Date.now()): boolean {
    if (!this.enabled || !state) return false;
    const parts = state.split(".");
    if (parts.length !== 3) return false;
    const [expiry, nonce, signature] = parts;
    if (!isDigits(expiry) || Number(expiry) * 1000 < now) return false;

    let ok = false;
    for (const token of this.tokens) {
      const expected = createHmac("sha256", token)
        .update(`${expiry}.${nonce}`)
        .digest("base64url");
      if (matches(signature, expected)) ok = true;
    }
    return ok;
  }
}
