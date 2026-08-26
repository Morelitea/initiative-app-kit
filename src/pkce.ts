/**
 * The half of an authorization code exchange that must not travel.
 *
 * A vendor redirects the member's browser back to your app with a code in the
 * query string, which means the code passes through a browser history, a proxy
 * log, and a referrer header on the way. PKCE is what makes that survivable:
 * the code is bound to a secret your server generated and never sent, so
 * whoever caught the redirect cannot exchange it.
 *
 * Here rather than in each app for the same reason as the cipher — the mistakes
 * are **silent**. Base64 where base64url was meant, a challenge hashed over the
 * wrong bytes, a verifier short enough to guess: every one of them produces a
 * flow that works perfectly in testing and protects nothing.
 *
 * **Storage is yours.** This mints a pair and takes no view on where the
 * verifier waits — the kit has no database, and an in-flight handshake belongs
 * beside whatever else your app keeps about it. Keep the verifier server-side,
 * send only the challenge, and spend the row once when the member comes back.
 */

import { createHash, randomBytes } from "node:crypto";

/** The only method worth sending. `plain` puts the verifier on the wire. */
export const CHALLENGE_METHOD = "S256";

/**
 * 32 bytes as base64url is 43 characters — the shortest the spec allows, and
 * the length most vendors' own examples use.
 */
const VERIFIER_BYTES = 32;

export interface Pkce {
  /** Keep this. It never leaves your server. */
  verifier: string;
  /** Send this, with `code_challenge_method=S256`. */
  challenge: string;
}

/** A fresh verifier and the challenge derived from it. */
export function mintPkce(): Pkce {
  const verifier = randomBytes(VERIFIER_BYTES).toString("base64url");
  return { verifier, challenge: challengeFor(verifier) };
}

/**
 * The S256 challenge for a verifier: base64url of its SHA-256, unpadded.
 *
 * Over the verifier's **ASCII characters**, not over the bytes it decodes to —
 * the spec derives the challenge from the string, and hashing the decoded bytes
 * produces a challenge the vendor will reject at exchange time and not before.
 */
export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
