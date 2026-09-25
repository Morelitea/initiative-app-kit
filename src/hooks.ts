/**
 * Answering Initiative's hook calls.
 *
 * Initiative runs every connection's vendor flow itself. At two points it asks
 * your app something, by calling `POST {your base}/v1/hooks/{name}` with a
 * context token of scope `lifecycle` that names the installation and the hook:
 *
 * - **`after_connect`**, once a flow's code is exchanged, when the flow sets
 *   `after_connect`. It carries the fresh access token and the flow's
 *   parameters (an installation-style flow's `installation_id`). Answer with
 *   the connection's managed values and an account label, or refuse.
 * - **`revoke`**, when a connection whose flow says `revoke: "hook"` ends. It
 *   carries the tokens so your app can end the grant at the vendor. Answer 204.
 * - **`webhook`**, for each community a vendor webhook delivery belongs to,
 *   when your manifest declares `webhooks`. Initiative has checked its
 *   signature and dropped a repeat; the call carries the vendor's `x-` headers
 *   and the raw body. Map it to your declared events and emit them on the
 *   installation's token. Answer 204; anything else has the vendor retry.
 *
 * {@link handleHook} verifies the token, routes by name, checks the body and
 * shapes the answer; your handlers do only the vendor work.
 */

import {
  ContextTokenError,
  bearerToken,
  verifyLifecycleToken,
  type ContextClaims,
  type VerifyOptions,
} from "./context.js";
import type { ActorKind } from "./manifest.js";

/** Where Initiative calls your hooks: `{HOOKS_PATH}/{name}`. */
export const HOOKS_PATH = "/v1/hooks";

/** The hooks Initiative calls. */
export type HookName = "after_connect" | "revoke" | "webhook";
export const HOOK_NAMES: readonly HookName[] = ["after_connect", "revoke", "webhook"];

/** What `after_connect` is sent. */
export interface AfterConnectCall {
  /** The connection's manifest id. */
  connection: string;
  /** `member` for a member's own account, `installation` for the community's. */
  actor: ActorKind;
  /** The access token the flow just obtained. Use it to look the account up. */
  access_token: string;
  /** The flow's parameters, such as the `installation_id` an install page returned. */
  params: Record<string, string>;
}

/** What `after_connect` answers: the managed values, or a refusal. */
export type AfterConnectAnswer =
  | {
      /** Values for the connection's managed fields. */
      values?: Record<string, unknown>;
      /** The vendor account connected, for display, such as `@alice`. */
      account_label?: string;
    }
  | { refuse: true };

/** What `revoke` is sent. */
export interface RevokeCall {
  connection: string;
  access_token?: string | null;
  refresh_token?: string | null;
}

/** What `webhook` is sent: one vendor delivery, for the installation the token names. */
export interface WebhookCall {
  /** The static connection the delivery was routed by. */
  connection: string;
  /** The vendor's `x-` headers, lowercased, such as `x-github-event`. */
  headers: Record<string, string>;
  /** The delivery's body, exactly as the vendor sent it. */
  body: string;
}

export interface HookHandlers {
  after_connect?: (call: AfterConnectCall, claims: ContextClaims) => Promise<AfterConnectAnswer>;
  revoke?: (call: RevokeCall, claims: ContextClaims) => Promise<void>;
  webhook?: (call: WebhookCall, claims: ContextClaims) => Promise<void>;
}

/** An incoming hook request, in whatever your framework gives you. */
export interface HookRequest {
  /** The request path, such as `/v1/hooks/after_connect`. A query is ignored. */
  path: string;
  headers: Record<string, string | string[] | undefined>;
  /** The parsed JSON body. */
  body: unknown;
}

/** What to answer with. `body` is JSON when present. */
export interface HookResponse {
  status: number;
  body?: unknown;
}

/** The hook a path names, or null when it names none. */
export function hookName(path: string): HookName | null {
  const bare = path.split("?")[0] ?? "";
  const prefix = `${HOOKS_PATH}/`;
  if (!bare.startsWith(prefix)) return null;
  const name = bare.slice(prefix.length);
  return (HOOK_NAMES as readonly string[]).includes(name) ? (name as HookName) : null;
}

/**
 * Verify, route and answer one hook call.
 *
 * 404 for a hook your app does not handle, 401 for a token that does not
 * verify or was minted for another hook, 400 for a body that is not the
 * hook's shape. A handler that throws is answered 500, which Initiative reads
 * as the hook failing.
 */
export async function handleHook(
  request: HookRequest,
  handlers: HookHandlers,
  verify: VerifyOptions
): Promise<HookResponse> {
  const name = hookName(request.path);
  if (name === null || handlers[name] === undefined) {
    return { status: 404, body: { error: "no such hook" } };
  }
  const token = bearerToken(request.headers);
  if (!token) return { status: 401, body: { error: "a bearer token is required" } };
  let claims: ContextClaims;
  try {
    claims = await verifyLifecycleToken(token, { ...verify, hook: name });
  } catch (error) {
    if (error instanceof ContextTokenError) {
      return { status: 401, body: { error: error.message } };
    }
    throw error;
  }

  const body = request.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { status: 400, body: { error: "expected a json object" } };
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.connection !== "string" || !raw.connection) {
    return { status: 400, body: { error: "connection is required" } };
  }

  try {
    if (name === "after_connect") {
      const call = afterConnectCall(raw);
      if (call === null) {
        return { status: 400, body: { error: "not an after_connect call" } };
      }
      const answer = await handlers.after_connect!(call, claims);
      return { status: 200, body: answer };
    }
    if (name === "webhook") {
      const call = webhookCall(raw);
      if (call === null) return { status: 400, body: { error: "not a webhook call" } };
      await handlers.webhook!(call, claims);
      return { status: 204 };
    }
    await handlers.revoke!(
      {
        connection: raw.connection,
        access_token: optionalString(raw.access_token),
        refresh_token: optionalString(raw.refresh_token),
      },
      claims
    );
    return { status: 204 };
  } catch {
    return { status: 500, body: { error: "the hook failed" } };
  }
}

function afterConnectCall(raw: Record<string, unknown>): AfterConnectCall | null {
  if (raw.actor !== "installation" && raw.actor !== "member") return null;
  if (typeof raw.access_token !== "string" || !raw.access_token) return null;
  const params: Record<string, string> = {};
  if (raw.params !== undefined && raw.params !== null) {
    if (typeof raw.params !== "object" || Array.isArray(raw.params)) return null;
    for (const [key, value] of Object.entries(raw.params as Record<string, unknown>)) {
      if (typeof value === "string") params[key] = value;
    }
  }
  return {
    connection: String(raw.connection),
    actor: raw.actor,
    access_token: raw.access_token,
    params,
  };
}

function webhookCall(raw: Record<string, unknown>): WebhookCall | null {
  if (typeof raw.body !== "string") return null;
  const bag = raw.headers;
  if (typeof bag !== "object" || bag === null || Array.isArray(bag)) return null;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(bag as Record<string, unknown>)) {
    if (typeof value === "string") headers[key.toLowerCase()] = value;
  }
  return { connection: String(raw.connection), headers, body: raw.body };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
