/**
 * Answering Initiative's calls to your app's endpoints.
 *
 * An app declares its endpoints in the manifest and serves all of them at one
 * path, {@link ENDPOINTS_PATH}. Initiative calls it to fill a widget or to run
 * a step another app or an automation asked for, always with a context token
 * (see `verifyContextToken`) and a body naming one endpoint id and its
 * parameters.
 *
 * {@link parseInvoke} checks the body against what your manifest declares and,
 * given the verified claims, that the token was minted for this endpoint.
 * Which community the call is for comes from the token, never from the body.
 */

import type { ContextClaims } from "./context.js";
import type { ActorKind, Endpoint } from "./manifest.js";

/** Discovery and invocation. `GET` lists what the app declares; `POST` calls one. */
export const ENDPOINTS_PATH = "/v1/endpoints";

/** What Initiative POSTs to {@link ENDPOINTS_PATH}. */
export interface InvokeRequest {
  endpoint: string;
  params: Record<string, unknown>;
}

/** What your app answers with. */
export interface InvokeOutcome {
  endpoint: string;
  /**
   * Whose credential ran the call. Always reported, including when an app
   * acted as its installation because the member had connected nothing.
   */
  actor: ActorKind;
  /**
   * What the app read, or the vendor's identifiers for what it changed. The
   * keys are the endpoint's declared `returns`; a key it did not declare is
   * not read.
   */
  result: Record<string, unknown>;
}

/** A refused call, with the sentence to answer with. */
export interface InvokeProblem {
  ok: false;
  error: string;
}

export type ParsedInvoke = { ok: true; request: InvokeRequest } | InvokeProblem;

/**
 * Check a call against what your app declares, before running it.
 *
 * `declared` is your manifest's endpoint list. An id outside it is refused, and
 * so is an `emit` endpoint, which is delivered to subscribers rather than
 * called. Pass the verified context `claims` too, and a token minted for a
 * different endpoint, or for a lifecycle notice, is refused.
 */
export function parseInvoke(
  body: unknown,
  declared: readonly Endpoint[],
  claims?: Pick<ContextClaims, "scope" | "endpoint_id">
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
  if (claims) {
    if (claims.scope !== "endpoint") {
      return { ok: false, error: "this token is not for calling an endpoint" };
    }
    if (claims.endpoint_id !== raw.endpoint) {
      return { ok: false, error: `this token is for '${claims.endpoint_id}', not '${raw.endpoint}'` };
    }
  }
  const params = raw.params ?? {};
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return { ok: false, error: "params must be an object" };
  }
  return {
    ok: true,
    request: {
      endpoint: raw.endpoint,
      params: params as Record<string, unknown>,
    },
  };
}
