/**
 * Reaching a vendor: starting the flow, finishing it, and failing out loud.
 *
 * An app that runs a vendor flow makes calls it does not control the other end
 * of — the redirect it builds, the token exchange, and whatever it asks next to
 * find out whose account it just got. Written straight against `fetch`, every
 * one of them throws: a reset connection, a proxy's HTML error page where JSON
 * was meant, a vendor having a bad afternoon. Thrown out of a callback handler
 * that becomes a 500 with a JSON body — on the one route in the whole app that
 * a person looks at in a browser, and usually in an app that had already
 * written the right page for exactly this and never reached it.
 *
 * Here rather than in each app because the same three things are got wrong
 * every time, and two of them are silent:
 *
 * - **A vendor that could not be reached has not said no.** A refusal and an
 *   outage need telling apart, because the remedies are opposites: a refusal
 *   means the grant is dead and the row should go, an outage means keep what
 *   you hold and ask again later. An app that collapses the two deletes every
 *   member's connection the first time the vendor is down.
 * - **A verifier is only worth sending if its challenge travelled.** PKCE binds
 *   the code to the server that asked for it, but only if the challenge reached
 *   the vendor's authorization step. Not every destination carries one: a
 *   vendor's own install page that starts the authorization itself keeps the
 *   parameters it documents and drops the rest. Sending a verifier for a
 *   challenge nobody recorded protects nothing at best, and is refused at
 *   worst. {@link beginAuthorization} mints the state and the pair together and
 *   returns a `verifier` that is `null` exactly when no challenge went out, so
 *   there is nothing to store and nothing to send back.
 * - **A call with no deadline is a call that can hang forever.** Whatever the
 *   caller was holding — a locked row, a request — it holds for as long as the
 *   vendor's socket stays open. {@link VENDOR_TIMEOUT_MS} ends it.
 *
 * **The vendor's URLs are still yours.** Nothing here knows where your vendor
 * lives, which scopes you want, or what it calls its own fields; it takes them
 * and takes no view. What it owns is the shape every one of these flows has,
 * and the answers that are not exceptions.
 */

import { randomUUID } from "node:crypto";

import { CHALLENGE_METHOD, mintPkce } from "./pkce.js";

/**
 * How long a vendor gets to answer before the call is abandoned.
 *
 * Long enough for a slow token endpoint, short enough that a hung socket does
 * not outlive the request that started it.
 */
export const VENDOR_TIMEOUT_MS = 10_000;

/** Why a JSON call did not produce a body. */
export type JsonFailure =
  /** No response at all: DNS, TLS, a reset, the deadline above. */
  | "unreachable"
  /** A response, outside 2xx. `status` says which. */
  | "http"
  /** A response, and not JSON — the shape a proxy's error page arrives in. */
  | "malformed";

/** What a vendor said, or why it did not say anything. Never a thrown error. */
export type JsonAnswer<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; reason: JsonFailure; status: number | null; detail: string };

/** Options {@link fetchJson} adds to `fetch`'s own. */
export interface JsonRequest extends RequestInit {
  /** Defaults to {@link VENDOR_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * A call to a vendor that answers instead of throwing.
 *
 * The body is parsed only far enough to say whether there is one, and is
 * returned as `T` unchecked — this promises that something arrived and that it
 * was JSON, not that it is what you expected. Read the fields you need
 * defensively, the way you would any value from somebody else's server.
 *
 * A 2xx with no body at all reads as `malformed`, since this is for calls that
 * answer with something. A route that legitimately replies `204` wants `fetch`.
 */
export async function fetchJson<T>(
  url: string,
  request: JsonRequest = {}
): Promise<JsonAnswer<T>> {
  const { timeoutMs = VENDOR_TIMEOUT_MS, signal, ...init } = request;

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: deadline(signal, timeoutMs) });
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      status: null,
      detail: (error as Error).message || "the vendor could not be reached",
    };
  }

  // Read the body before branching on the status: a vendor that refuses
  // usually says why in it, and that sentence is the whole of what a log has.
  let body: unknown;
  let parsed = true;
  try {
    body = await response.json();
  } catch {
    parsed = false;
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "http",
      status: response.status,
      detail: said(parsed ? body : undefined, `${response.status} ${response.statusText}`),
    };
  }

  if (!parsed) {
    return {
      ok: false,
      reason: "malformed",
      status: response.status,
      detail: `${response.status} with a body that is not JSON`,
    };
  }

  return { ok: true, status: response.status, body: body as T };
}

/** A flow about to begin: what to store, and what to send. */
export interface Authorization {
  /** Store it against the flow, and spend the row once when they come back. */
  state: string;
  /**
   * The half that must not travel — or `null` when no challenge went out, and
   * there is therefore nothing to send back at exchange time.
   *
   * Store it exactly as it is, `null` included. Anything else is a claim about
   * a binding that was never made.
   */
  verifier: string | null;
  /** What goes on the URL you send the member to. */
  params: URLSearchParams;
}

/** What {@link beginAuthorization} puts on the URL. All of it optional. */
export interface AuthorizationRequest {
  clientId?: string;
  redirectUri?: string | null;
  /** Space-separated, as the vendor wants it. Omitted when there is none. */
  scope?: string | null;
  /**
   * Whether these parameters reach the vendor's **authorization** step.
   *
   * `true` (the default) is the ordinary redirect to the vendor's authorize
   * URL. `false` is for a destination that starts the authorization itself and
   * carries only the parameters it documents — a vendor's install page, a
   * marketplace hand-off. No challenge is sent, and no verifier comes back.
   */
  pkce?: boolean;
  /** Anything else the vendor takes, set last. */
  extra?: Record<string, string>;
}

/**
 * Mint a flow: a state, a PKCE pair when the destination will carry one, and
 * the parameters that say so.
 *
 * The point of returning all three together is that they cannot disagree. The
 * verifier is present exactly when `code_challenge` is in `params`, so an app
 * that stores what it is handed cannot end up sending a verifier for a
 * challenge that was dropped on the way.
 */
export function beginAuthorization(
  request: AuthorizationRequest = {}
): Authorization {
  const state = randomUUID();
  const pkce = request.pkce === false ? null : mintPkce();

  const params = new URLSearchParams();
  if (request.clientId) params.set("client_id", request.clientId);
  if (request.redirectUri) params.set("redirect_uri", request.redirectUri);
  if (request.scope) params.set("scope", request.scope);
  params.set("state", state);
  if (pkce) {
    params.set("code_challenge", pkce.challenge);
    params.set("code_challenge_method", CHALLENGE_METHOD);
  }
  for (const [key, value] of Object.entries(request.extra ?? {})) {
    params.set(key, value);
  }

  return { state, verifier: pkce?.verifier ?? null, params };
}

/** What a vendor granted, in the fields every vendor has. */
export interface Grant {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds. `null` when the vendor did not say, which means it does not lapse. */
  expiresIn: number | null;
  /** Seconds. A common extension; `null` where the vendor has no such idea. */
  refreshExpiresIn: number | null;
  /** Everything it sent, for the fields only your vendor has. */
  raw: Record<string, unknown>;
}

/**
 * How a token request ended.
 *
 * The two failures are not degrees of the same thing. `refused` is the vendor's
 * answer — this code is spent, this refresh token is revoked — and the row it
 * was about is finished. `unreachable` is the absence of an answer, and says
 * nothing about the grant: hold what you have and ask again.
 */
export type Exchange =
  | { ok: true; grant: Grant }
  | { ok: false; reason: "refused" | "unreachable"; detail: string };

/** An authorization code, spent. */
export interface CodeExchange {
  tokenUrl: string;
  clientId: string;
  /** Omitted by a public client that has none. */
  clientSecret?: string;
  code: string;
  /** The one the authorization was begun with, where the vendor checks it. */
  redirectUri?: string | null;
  /**
   * The verifier from {@link Authorization}. Pass it through as it came:
   * `null` sends nothing, which is the right thing when no challenge went out.
   */
  verifier?: string | null;
  timeoutMs?: number;
}

/** Spend an authorization code for a grant. */
export function exchangeCode(request: CodeExchange): Promise<Exchange> {
  return tokenRequest(
    request.tokenUrl,
    {
      grant_type: "authorization_code",
      client_id: request.clientId,
      ...(request.clientSecret ? { client_secret: request.clientSecret } : {}),
      code: request.code,
      ...(request.redirectUri ? { redirect_uri: request.redirectUri } : {}),
      ...(request.verifier ? { code_verifier: request.verifier } : {}),
    },
    request.timeoutMs
  );
}

/** A refresh token, spent. */
export interface GrantRefresh {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  timeoutMs?: number;
}

/**
 * Trade a refresh token for a fresh grant.
 *
 * Act on `reason` before deleting anything. A vendor that refuses has ended the
 * grant; a vendor that could not be reached has not, and treating the two the
 * same is how an outage becomes every member reconnecting.
 */
export function refreshGrant(request: GrantRefresh): Promise<Exchange> {
  return tokenRequest(
    request.tokenUrl,
    {
      grant_type: "refresh_token",
      client_id: request.clientId,
      ...(request.clientSecret ? { client_secret: request.clientSecret } : {}),
      refresh_token: request.refreshToken,
    },
    request.timeoutMs
  );
}

async function tokenRequest(
  tokenUrl: string,
  body: Record<string, string>,
  timeoutMs?: number
): Promise<Exchange> {
  const answer = await fetchJson<Record<string, unknown>>(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    // Form-encoded, which is what the grant types are specified in and the only
    // encoding some vendors read. `Accept` is what asks for JSON back.
    body: new URLSearchParams(body).toString(),
    timeoutMs,
  });

  if (!answer.ok) {
    return { ok: false, reason: verdict(answer), detail: answer.detail };
  }

  // The refusal that arrives as a 200. Several vendors answer a dead code with
  // `{"error": ...}` and a success status, so the body decides, not the code.
  const accessToken = answer.body.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    return {
      ok: false,
      reason: "refused",
      detail: said(answer.body, "the vendor granted no access token"),
    };
  }

  const refreshToken = answer.body.refresh_token;
  return {
    ok: true,
    grant: {
      accessToken,
      refreshToken: typeof refreshToken === "string" && refreshToken ? refreshToken : null,
      expiresIn: seconds(answer.body.expires_in),
      refreshExpiresIn: seconds(answer.body.refresh_token_expires_in),
      raw: answer.body,
    },
  };
}

/**
 * Whether a failed call was the vendor saying no.
 *
 * Only a 4xx is an answer about the grant. A 5xx is the vendor failing to have
 * one, a 429 is it declining to look, and everything else never got there — all
 * of which leave the grant exactly as it was. Unknown is not refused.
 */
function verdict(answer: { reason: JsonFailure; status: number | null }): "refused" | "unreachable" {
  if (answer.reason !== "http" || answer.status === null) return "unreachable";
  if (answer.status === 429) return "unreachable";
  return answer.status >= 400 && answer.status < 500 ? "refused" : "unreachable";
}

/** The sentence a vendor put in the body, in the keys they use to put it there. */
function said(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    for (const key of ["error_description", "error", "message"]) {
      const value = (body as Record<string, unknown>)[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return fallback;
}

/** A lifetime the vendor may have written as a number or as digits. */
function seconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function deadline(
  signal: AbortSignal | null | undefined,
  timeoutMs: number
): AbortSignal {
  const timer = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}
