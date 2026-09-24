/**
 * Verifying the webhooks Initiative delivers.
 *
 * A webhook subscription has its own secret, shown once when the subscription
 * is created. Every delivery carries three headers:
 *
 * - `X-Initiative-Timestamp` — seconds since the epoch, when it was signed;
 * - `X-Initiative-Signature` — `sha256=<hex>`, an HMAC-SHA256 under the
 *   subscription's secret over `timestamp + "." + body`;
 * - `X-Initiative-Event-ID` — the same on every retry of one event, so a
 *   receiver can drop repeats.
 *
 * {@link verifyWebhook} checks the signature and that the timestamp is within
 * a window of now. Recording event ids to drop repeats needs storage with a
 * lifetime, so it is the receiver's.
 *
 * Verify the body exactly as it arrived. A body parsed and re-serialized is
 * not the one that was signed.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TIMESTAMP_HEADER = "X-Initiative-Timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "X-Initiative-Signature";
export const WEBHOOK_EVENT_ID_HEADER = "X-Initiative-Event-ID";

/** How far a delivery's timestamp may be from now, in seconds. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

export type WebhookVerification =
  | { ok: true; eventId: string | null; timestamp: number }
  | {
      ok: false;
      reason: "missing_signature" | "missing_timestamp" | "stale_timestamp" | "bad_signature";
    };

/**
 * `sha256=<hex>` over `timestamp + "." + body`: the value Initiative puts in
 * `X-Initiative-Signature`. Useful for testing a receiver.
 */
export function signWebhook(
  secret: string,
  timestamp: string,
  body: string | Uint8Array
): string {
  const mac = createHmac("sha256", Buffer.from(secret, "utf-8"));
  mac.update(timestamp, "utf-8");
  mac.update(".", "utf-8");
  mac.update(typeof body === "string" ? Buffer.from(body, "utf-8") : body);
  return `sha256=${mac.digest("hex")}`;
}

/** Check one delivery's signature and timestamp. */
export function verifyWebhook(options: {
  /** The subscription's secret. */
  secret: string;
  /** The raw request body, exactly as received. */
  body: string | Uint8Array;
  headers: HeaderBag;
  /** Milliseconds since the epoch. Defaults to `Date.now`. */
  now?: () => number;
  toleranceSeconds?: number;
}): WebhookVerification {
  const signature = header(options.headers, WEBHOOK_SIGNATURE_HEADER);
  if (!signature) return { ok: false, reason: "missing_signature" };
  const stamp = header(options.headers, WEBHOOK_TIMESTAMP_HEADER);
  if (!stamp || !isDigits(stamp)) return { ok: false, reason: "missing_timestamp" };

  const timestamp = Number(stamp);
  const now = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: "stale_timestamp" };

  const expected = Buffer.from(signWebhook(options.secret, stamp, options.body), "utf-8");
  const given = Buffer.from(signature.trim(), "utf-8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true, eventId: header(options.headers, WEBHOOK_EVENT_ID_HEADER), timestamp };
}

/** One header's value, case-insensitively, from either kind of header bag. */
function header(headers: HeaderBag, name: string): string | null {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== wanted) continue;
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" ? first : null;
  }
  return null;
}

function isDigits(value: string): boolean {
  if (!value) return false;
  for (const character of value) {
    if (character < "0" || character > "9") return false;
  }
  return true;
}
