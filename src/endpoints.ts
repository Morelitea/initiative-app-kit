/**
 * Calling an app: one route, one vocabulary, two kinds of caller.
 *
 * An app declares its endpoints in the manifest and serves all of them here.
 * Initiative calls to fill a widget; an automation service calls to ask the app
 * to act at its vendor. Both send an endpoint id and parameters to the same
 * path, and what separates them is the token they prove themselves with — a
 * context token Initiative signed, or a delegation token a delegate signed.
 *
 * ## Why the write goes through the app
 *
 * The app is the only party holding the vendor's credential, and that is the
 * containment rather than an accident of layering. An automation service that
 * held GitHub tokens would be a second place they can leak from and a second
 * thing an operator has to reason about when revoking. Keeping the credential
 * on the app means the vendor's own grant is the whole of what any caller can
 * do there, visible in the vendor's settings and revoked with the button that
 * already lives there.
 *
 * So a caller sends an id and parameters, and gets back what happened. It never
 * sees a token, never learns which account acted, and cannot reach anything the
 * app has not declared.
 *
 * ## Who the call is attributed to
 *
 * Two answers, and an app should prefer the first:
 *
 * - **The member.** A delegation token names the member it acts for by a
 *   pairwise subject — opaque to everyone, including you.
 *   {@link InitiativeChannel.resolveDelegate} asks Initiative to turn it into
 *   one of *your own* connection refs, which is the same handle a context token
 *   hands over. You learn "this call is for the member you know as `ref-abc`"
 *   and nothing more, so it runs on that member's own credential and the
 *   vendor's audit log names a person.
 * - **The installation.** Where the member has connected no account, an app can
 *   still act as itself. That is a real answer and not a fallback to hide: the
 *   actor changed, so {@link InvokeOutcome.actor} says which one ran, and the
 *   caller decides whether that is acceptable.
 *
 * Which actors an endpoint permits is the app's declaration. What this module
 * fixes is that the answer is always reported.
 */

import type { ActorKind, Endpoint } from "./manifest.js";

/** Discovery and invocation. `GET` lists what the app declares; `POST` calls one. */
export const ENDPOINTS_PATH = "/v1/endpoints";

/** What a caller POSTs to {@link ENDPOINTS_PATH}. */
export interface InvokeRequest {
  endpoint: string;
  guild_id: number;
  params: Record<string, unknown>;
}

/** What it gets back. */
export interface InvokeOutcome {
  endpoint: string;
  /**
   * Whose credential actually ran it.
   *
   * Always reported, including when it is the one the caller expected. An app
   * that acted as itself because the member had connected nothing has done
   * something different from what was asked, and saying so is the difference
   * between a fallback and a surprise.
   */
  actor: ActorKind;
  /**
   * What the app read, or the vendor's identifiers for what it changed.
   *
   * The keys are the endpoint's own `returns` and nothing else — there is no
   * envelope around them, and a key you did not declare is not read. A consumer
   * reads the answer *through* that declaration: Initiative's widget plane takes
   * the returns marked `list` and reads them side by side by index into rows,
   * and keeps the single-valued ones whole beside them, so what an answer says
   * about itself — a total, a reason there is nothing — is still there when the
   * set is empty.
   */
  result: Record<string, unknown>;
}

/** A rejected call, with the sentence to answer with. */
export interface InvokeProblem {
  ok: false;
  error: string;
}

export type ParsedInvoke = { ok: true; request: InvokeRequest } | InvokeProblem;

/**
 * Check a call against what your app declares, before running it.
 *
 * `declared` is your manifest's endpoint list. An id outside it is refused here
 * rather than falling through to a handler that does not exist — an app's
 * endpoints are a closed set by construction, and that is most of what makes
 * this surface safe to expose at all: a caller chooses among things you wrote,
 * never describes a request you then perform.
 *
 * An `emit` endpoint is refused too. Those travel the other way, so there is
 * nothing to call — a subscriber registers a URL for one instead.
 *
 * What is deliberately **not** checked: whether the caller may act for
 * `guild_id`. That is the token's job and belongs to the route, because it
 * decides whether to read the body at all.
 */
export function parseInvoke(
  body: unknown,
  declared: readonly Endpoint[]
): ParsedInvoke {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "expected a json object" };
  }
  const raw = body as Partial<InvokeRequest>;

  if (typeof raw.endpoint !== "string" || !raw.endpoint) {
    return { ok: false, error: "endpoint is required" };
  }
  const endpoint = declared.find((candidate) => candidate.id === raw.endpoint);
  if (!endpoint) {
    return { ok: false, error: `this app does not offer '${raw.endpoint}'` };
  }
  if (endpoint.direction === "emit") {
    return {
      ok: false,
      error: `'${raw.endpoint}' is emitted rather than called — subscribe to it instead`,
    };
  }
  if (!Number.isInteger(raw.guild_id)) {
    return { ok: false, error: "guild_id must be an integer" };
  }
  const params = raw.params ?? {};
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return { ok: false, error: "params must be an object" };
  }
  return {
    ok: true,
    request: {
      endpoint: raw.endpoint,
      guild_id: raw.guild_id as number,
      params: params as Record<string, unknown>,
    },
  };
}
