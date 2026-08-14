/**
 * Signing and verifying calls on the app channel.
 *
 * An app holds one secret — the one its registration was wired with — and every
 * request it makes to Initiative carries a signature over the method, path,
 * timestamp, nonce and a digest of the raw body. The caller is established by
 * that signature; the `X-Initiative-App` header only says which key to check
 * against.
 *
 * Three properties the platform's verifier keeps, which this side has to match:
 *
 * - **The body is hashed as bytes, before parsing.** Sign the exact payload you
 *   send. Re-serializing an object after signing it will not verify.
 * - **Freshness is bounded** to {@link SIGNATURE_WINDOW_SECONDS} either side of
 *   now, so a clock more than five minutes out will be refused.
 * - **A nonce is spent once.** Generate a fresh one per request;
 *   {@link mintNonce} does.
 */

import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";

/** Names the registration whose secret the signature verifies under. */
export const APP_HEADER = "X-Initiative-App";
/** Unix seconds at which the caller signed. */
export const TIMESTAMP_HEADER = "X-Initiative-Timestamp";
/** A value the caller does not repeat. */
export const NONCE_HEADER = "X-Initiative-Nonce";
/** `sha256=<hex>`. */
export const SIGNATURE_HEADER = "X-Initiative-Signature";

/** How far a signed timestamp may sit from now, in either direction. */
export const SIGNATURE_WINDOW_SECONDS = 300;

/** The platform refuses a longer one without looking it up. */
export const MAX_NONCE_LENGTH = 64;

const SIGNATURE_PREFIX = "sha256=";

/**
 * The bytes both sides run the MAC over: newline-joined fields ending in a
 * digest of the raw body.
 */
export function signingMaterial(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: Uint8Array;
}): Buffer {
  const bodyDigest = createHash("sha256").update(input.body).digest("hex");
  return Buffer.from(
    [
      input.method.toUpperCase(),
      input.path,
      input.timestamp,
      input.nonce,
      bodyDigest,
    ].join("\n"),
    "utf-8"
  );
}

/** The `X-Initiative-Signature` value for a request. */
export function signRequest(
  secret: string,
  input: {
    method: string;
    path: string;
    timestamp: string;
    nonce: string;
    body: Uint8Array;
  }
): string {
  const digest = createHmac("sha256", Buffer.from(secret, "utf-8"))
    .update(signingMaterial(input))
    .digest("hex");
  return `${SIGNATURE_PREFIX}${digest}`;
}

/** A nonce of the shape the platform accepts, fresh per request. */
export function mintNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Every header a signed request needs.
 *
 * `path` is the request path alone — no scheme, no host, no query string beyond
 * what you actually send, because the platform signs what it received.
 */
export function signedHeaders(input: {
  publicId: string;
  secret: string;
  method: string;
  path: string;
  body?: Uint8Array;
  /** Injectable so a test can pin the moment it signed at. */
  now?: () => number;
}): Record<string, string> {
  const body = input.body ?? new Uint8Array();
  const timestamp = String(Math.floor((input.now?.() ?? Date.now()) / 1000));
  const nonce = mintNonce();
  return {
    [APP_HEADER]: input.publicId,
    [TIMESTAMP_HEADER]: timestamp,
    [NONCE_HEADER]: nonce,
    [SIGNATURE_HEADER]: signRequest(input.secret, {
      method: input.method,
      path: input.path,
      timestamp,
      nonce,
      body,
    }),
  };
}

/** Why a signed request was refused. */
export type VerifyFailure =
  | "missing_signature"
  | "stale_timestamp"
  | "bad_signature";

export type VerifyResult =
  | { ok: true; publicId: string; nonce: string }
  | { ok: false; reason: VerifyFailure };

/**
 * Verify a request the platform signed to *you*.
 *
 * Same shape in the other direction — Initiative signs its calls to an app with
 * the same secret. Header lookup is case-insensitive, since most servers
 * lower-case them.
 *
 * The nonce is returned rather than remembered: replay protection needs storage
 * with a lifetime, which belongs to the app. Reject a nonce you have already
 * seen within {@link SIGNATURE_WINDOW_SECONDS}.
 */
export function verifyRequest(input: {
  secret: string;
  method: string;
  path: string;
  body: Uint8Array;
  headers: Record<string, string | string[] | undefined>;
  now?: () => number;
}): VerifyResult {
  const read = (name: string): string => {
    const found = input.headers[name] ?? input.headers[name.toLowerCase()];
    const value = Array.isArray(found) ? found[0] : found;
    return (value ?? "").trim();
  };

  const publicId = read(APP_HEADER).toLowerCase();
  const rawTimestamp = read(TIMESTAMP_HEADER);
  const nonce = read(NONCE_HEADER);
  const signature = read(SIGNATURE_HEADER).toLowerCase();

  if (!publicId || !rawTimestamp || !nonce || !signature) {
    return { ok: false, reason: "missing_signature" };
  }
  if (nonce.length > MAX_NONCE_LENGTH || !signature.startsWith(SIGNATURE_PREFIX)) {
    return { ok: false, reason: "missing_signature" };
  }

  const timestamp = Number.parseInt(rawTimestamp, 10);
  if (!Number.isInteger(timestamp)) {
    return { ok: false, reason: "stale_timestamp" };
  }
  const seconds = Math.floor((input.now?.() ?? Date.now()) / 1000);
  if (Math.abs(seconds - timestamp) > SIGNATURE_WINDOW_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = signRequest(input.secret, {
    method: input.method,
    path: input.path,
    timestamp: rawTimestamp,
    nonce,
    body: input.body,
  });
  if (!constantTimeEquals(expected, signature)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true, publicId, nonce };
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf-8");
  const right = Buffer.from(b, "utf-8");
  // `timingSafeEqual` throws on a length mismatch, which would itself be a
  // signal; compare lengths first and fall through to a fixed-cost comparison.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The answer to a registration handshake challenge.
 *
 * The platform posts `{challenge}` to `/v1/handshake` and expects
 * `HMAC-SHA256(secret, challenge)` back as hex — both ends prove they hold the
 * same secret, and neither sends it.
 */
export function answerChallenge(secret: string, challenge: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf-8"))
    .update(challenge, "utf-8")
    .digest("hex");
}
