/**
 * Where a member lands when a vendor flow ends.
 *
 * A connection with `scope: "interactive"` sends the member out to a vendor,
 * and something has to be on the screen when they come back. Doing that in the
 * app means every app writes the same three sentences — and writes them in one
 * language, because an app knows a `connection_ref` and a guild id and has
 * never been told what language that person reads. Initiative knows. So the
 * app finishes the exchange and hands the member back, and Initiative renders
 * the ending in the product they were already in.
 *
 * **The rule is who sent them.** Initiative puts a return address on the
 * connect URL, so a member Initiative sent goes back to Initiative. Somebody
 * who arrived any other way — a hand-copied link, a vendor's own setup
 * redirect — carries no return address and gets a plain page from the app,
 * which is the honest answer: nothing here knows where they came from.
 *
 * **The address is signed, and that is not decoration.** It rides in the query
 * string, which means the browser carries it and anyone can propose one. An app
 * that redirected to whatever it was handed would be a redirector on a
 * trusted domain: a link on your app's hostname, a real vendor login, and a
 * landing somewhere else entirely. The signature is over the address with the
 * secret the registration was already wired with, so an address Initiative did
 * not write does not verify and is refused rather than followed.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** The return address Initiative put on the connect URL. */
export const RETURN_URL_PARAM = "return_url";

/** Its signature, hex, under the registration's secret. */
export const RETURN_SIGNATURE_PARAM = "return_sig";

/** What Initiative reads back off the landing to know what to say. */
export const OUTCOME_PARAM = "outcome";

/**
 * How a vendor flow ended, in the four ways it can.
 *
 * One closed set for every app, which is what lets Initiative write the copy
 * once. They are distinguished by *whose move is next*, because that is the
 * only thing the member needs from the page:
 *
 * - `connected` — nobody's. It worked.
 * - `refused` — theirs, at the vendor: they declined, or the vendor would not
 *   complete the exchange.
 * - `expired` — theirs, here: the link sat too long or was already spent, and
 *   starting again from the app's settings is all it takes.
 * - `not_recorded` — theirs, here, but nothing was lost: the app holds the
 *   credential and Initiative did not record it, so connecting again is safe
 *   and is the remedy.
 */
export type ConnectOutcome = "connected" | "refused" | "expired" | "not_recorded";

/**
 * Sign a return address. Initiative's side of the contract.
 *
 * Over the address exactly as it will be sent — a URL re-encoded after signing
 * will not verify, for the same reason a re-serialized body will not.
 */
export function signReturnUrl(secret: string, returnUrl: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf-8"))
    .update(returnUrl, "utf-8")
    .digest("hex");
}

/**
 * The return address off a connect URL, or `null` if there is not a good one.
 *
 * `null` is the ordinary answer as well as the refused one, and the caller
 * treats them the same: with no address to go back to, the app says its piece
 * on its own page. Nothing here distinguishes "absent" from "forged", because
 * the app does the same thing either way and a message that told them apart
 * would only be useful to whoever forged one.
 *
 * Only `https` is accepted, and `http` on a loopback host so a development
 * deployment works. A return address is a place a browser is sent after a
 * vendor flow; `javascript:` and `data:` are not places.
 */
export function returnAddress(input: {
  secret: string;
  params: URLSearchParams;
}): string | null {
  const offered = input.params.get(RETURN_URL_PARAM);
  const signature = input.params.get(RETURN_SIGNATURE_PARAM);
  if (!offered || !signature) return null;

  const expected = signReturnUrl(input.secret, offered);
  if (!constantTimeEquals(expected, signature.trim().toLowerCase())) return null;

  let parsed: URL;
  try {
    parsed = new URL(offered);
  } catch {
    return null;
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    return null;
  }
  return offered;
}

/**
 * The address to send the member back to, with the outcome on it.
 *
 * Appended rather than replacing the query, since Initiative's landing may
 * carry its own parameters — which app, which connection — and this adds one
 * word to them.
 */
export function landingUrl(returnUrl: string, outcome: ConnectOutcome): string {
  const url = new URL(returnUrl);
  url.searchParams.set(OUTCOME_PARAM, outcome);
  return url.toString();
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf-8");
  const right = Buffer.from(b, "utf-8");
  // `timingSafeEqual` throws on a length mismatch, which would itself be a
  // signal; compare lengths first and fall through to a fixed-cost comparison.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
