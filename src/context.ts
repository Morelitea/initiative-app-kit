/**
 * Verifying the tokens Initiative signs when it reaches your app.
 *
 * Two kinds, both RS256 JWTs signed with the deployment's key and published in
 * its JWKS at `/api/v1/app-platform/jwks.json`:
 *
 * - **Context token** — on every call Initiative makes to your app
 *   (`Authorization: Bearer …`). It names one community, one installation and
 *   one scope, lives about a minute, and carries no person. Scope `endpoint`
 *   is a call to one of your endpoints; scope `lifecycle` is a call to one of
 *   your hooks, and names it in `hook`. Where a call depends on a member's own
 *   credential it carries `connection_refs`: the handles you ask Initiative
 *   for an access token with. When another app made the call through
 *   Initiative, it also carries `act` (the calling app), `actor` (the
 *   community or a member), `member` (that member, by your own reference for
 *   them) and, when the caller was confined to one, `initiative_id`.
 * - **Handoff token** — when a member opens one of your surfaces. It names the
 *   member by their reference for your installation (`sub`), the surface, and
 *   the initiative it was opened in, if any. It is for one use: record its
 *   `jti` until it expires and refuse it a second time.
 *
 * Both are checked the same way: the `kid` against the deployment's JWKS, the
 * RS256 signature, `iss` = `initiative`, `aud` = `initiative-app:<your public
 * id>`, and `exp`/`iat` against the clock with a small leeway.
 */

import { createPublicKey, createVerify, type KeyObject } from "node:crypto";

import { ACTOR_KINDS, type ActorKind } from "./contract.js";

/**
 * What a context token authorizes.
 *
 * `endpoint` covers every call to an endpoint your app declares; the id says
 * which. `lifecycle` is Initiative calling one of your hooks about an
 * installation; `hook` says which.
 */
export type ContextScope = "endpoint" | "lifecycle";

/** Where the deployment publishes its verification keys. */
export const JWKS_PATH = "/api/v1/app-platform/jwks.json";

/** How long a fetched key set is reused before a refetch is considered. */
export const JWKS_CACHE_SECONDS = 300;

/** The `iss` every token from Initiative carries. */
export const INITIATIVE_ISSUER = "initiative";

/** Claims every token from Initiative carries. */
export interface InitiativeTokenClaims {
  jti: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  /**
   * The community, by the reference your installation knows it by. Stable for
   * your installation, so it is what your own rows key on.
   */
  guild_ref: string;
  /** The installation within that community. */
  app_install_id: number;
}

export interface ContextClaims extends InitiativeTokenClaims {
  scope: ContextScope;
  /** Which endpoint this call is for. Present when the scope is `endpoint`. */
  endpoint_id?: string;
  /** Which hook this call is for. Present when the scope is `lifecycle`. */
  hook?: string;
  /**
   * Connection id → the opaque handle you ask Initiative for an access token
   * with. Present only where the call depends on a connection. On a call from
   * another app it holds only what the actor may use: the member's own
   * connections for a `member` call, the community's for an `installation`
   * one.
   */
  connection_refs?: Record<string, string>;
  /**
   * Present when another app made this call through Initiative: that app's
   * public id, as `act.sub` (RFC 8693 §4.1). Absent when Initiative itself
   * called, for a widget.
   */
  act?: { sub: string };
  /**
   * On a call from another app: whose behalf it is on. `installation` is the
   * community; `member` is the member named in {@link ContextClaims.member}.
   */
  actor?: ActorKind;
  /**
   * On a `member` call: the member, by the reference your installation knows
   * them by. The calling app never sees it.
   */
  member?: string;
  /**
   * On a call from another app whose token is confined to one initiative: that
   * initiative. Your app is placed there too.
   */
  initiative_id?: number;
}

export interface HandoffClaims extends InitiativeTokenClaims {
  /** The member, by their reference for your installation. */
  sub: string;
  /** Which of your surfaces was opened. */
  surface_id: string;
  /** The initiative it was opened in. Absent when opened for the whole community. */
  initiative_id?: number;
}

export class ContextTokenError extends Error {}

/** The audience a token for `publicId` names. */
export function audienceFor(publicId: string): string {
  return `initiative-app:${publicId}`;
}

interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
}

interface CacheEntry {
  keys: Map<string, KeyObject>;
  fetchedAt: number;
  /** Whether this set was itself fetched to answer a miss in its window. */
  refetched: boolean;
}

/**
 * Fetches and caches a deployment's published verification keys, by `kid`.
 *
 * An unknown `kid` refetches the set once, so a key rotation (which publishes
 * both keys for a while) resolves without a restart. A second miss inside the
 * same window does not refetch again.
 */
export class JwksCache {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly options: {
      /** Injectable for tests and for a runtime with its own fetch. */
      fetchImpl?: typeof fetch;
      /** Milliseconds since the epoch. */
      now?: () => number;
      cacheSeconds?: number;
      /** Which document to read. Defaults to {@link JWKS_PATH}. */
      path?: string;
    } = {}
  ) {}

  /** The key for `kid`, fetching the set if it is unknown or stale. */
  async keyFor(baseUrl: string, kid: string): Promise<KeyObject> {
    const document = new URL(this.options.path ?? JWKS_PATH, baseUrl).toString();
    const entry = this.cache.get(document);
    const now = this.options.now?.() ?? Date.now();
    const ttl = (this.options.cacheSeconds ?? JWKS_CACHE_SECONDS) * 1000;
    const fresh = entry !== undefined && now - entry.fetchedAt < ttl;

    if (fresh) {
      const cached = entry!.keys.get(kid);
      if (cached) return cached;
      if (entry!.refetched) return missing(document, entry!.keys, kid);
    }
    const keys = await this.load(document);
    this.cache.set(document, { keys, fetchedAt: now, refetched: fresh });
    const found = keys.get(kid);
    if (!found) return missing(document, keys, kid);
    return found;
  }

  private async load(document: string): Promise<Map<string, KeyObject>> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const response = await doFetch(document);
    if (response.status === 404) return new Map();
    if (!response.ok) {
      throw new ContextTokenError(`jwks fetch failed with ${response.status}`);
    }
    const parsed = (await response.json()) as { keys?: Jwk[] };
    const keys = new Map<string, KeyObject>();
    for (const jwk of parsed.keys ?? []) {
      if (jwk.kty !== "RSA" || !jwk.kid || !jwk.n || !jwk.e) continue;
      keys.set(jwk.kid, createPublicKey({ key: jwk as never, format: "jwk" }));
    }
    return keys;
  }
}

/** The same refusal for "no keys published" and "no such key". */
function missing(document: string, keys: Map<string, unknown>, kid: string): never {
  throw new ContextTokenError(
    keys.size === 0
      ? `${document} published no keys`
      : `no verification key published for kid ${kid}`
  );
}

export interface VerifyOptions {
  /** Your app's public id. The audience must name it. */
  publicId: string;
  /** The deployment, for key lookup: its origin or its API base. */
  baseUrl: string;
  jwks: JwksCache;
  /** Defaults to {@link INITIATIVE_ISSUER}. */
  issuer?: string;
  /** Milliseconds since the epoch. */
  now?: () => number;
  /** Tolerance for clock skew, in seconds. Default 30. */
  leewaySeconds?: number;
}

/** Verify a context token and return its claims. */
export async function verifyContextToken(
  token: string,
  options: VerifyOptions
): Promise<ContextClaims> {
  const claims = (await verifyInitiativeToken(token, options)) as ContextClaims;
  if (claims.scope !== "endpoint" && claims.scope !== "lifecycle") {
    throw new ContextTokenError(`not a context token (scope ${String(claims.scope)})`);
  }
  checkCaller(claims);
  return claims;
}

/**
 * The claims naming another app's call, checked for shape: an `act` names the
 * caller, an `actor` is one of the two kinds, and a `member` call names its
 * member.
 */
function checkCaller(claims: ContextClaims): void {
  if (claims.act !== undefined) {
    const act = claims.act as unknown;
    if (
      typeof act !== "object" ||
      act === null ||
      typeof (act as { sub?: unknown }).sub !== "string" ||
      !(act as { sub: string }).sub
    ) {
      throw new ContextTokenError("act names no calling app");
    }
  }
  if (claims.actor !== undefined && !ACTOR_KINDS.includes(claims.actor)) {
    throw new ContextTokenError(`unknown actor ${String(claims.actor)}`);
  }
  if (claims.actor === "member" && (typeof claims.member !== "string" || !claims.member)) {
    throw new ContextTokenError("a member call names no member");
  }
  if (
    claims.initiative_id !== undefined &&
    (!Number.isInteger(claims.initiative_id) || claims.initiative_id <= 0)
  ) {
    throw new ContextTokenError("initiative_id is not an initiative");
  }
}

/**
 * Verify a handoff token and return its claims.
 *
 * Single use is yours to enforce: record `jti` until `exp` and refuse a token
 * whose `jti` you have already seen.
 */
export async function verifyHandoffToken(
  token: string,
  options: VerifyOptions
): Promise<HandoffClaims> {
  const claims = (await verifyInitiativeToken(token, options)) as HandoffClaims;
  if (typeof claims.sub !== "string" || !claims.sub) {
    throw new ContextTokenError("handoff token names no member");
  }
  if (typeof claims.surface_id !== "string" || !claims.surface_id) {
    throw new ContextTokenError("handoff token names no surface");
  }
  return claims;
}

/**
 * Verify the token on a call to one of your hooks, and return its claims.
 *
 * Refuses anything but a `lifecycle` token, and, when `hook` is given, one
 * minted for another hook: a token for `revoke` cannot be spent on
 * `after_connect`.
 */
export async function verifyLifecycleToken(
  token: string,
  options: VerifyOptions & { hook?: string }
): Promise<ContextClaims> {
  const claims = await verifyContextToken(token, options);
  if (claims.scope !== "lifecycle") {
    throw new ContextTokenError(`not a lifecycle token (scope ${String(claims.scope)})`);
  }
  if (options.hook !== undefined && claims.hook !== options.hook) {
    throw new ContextTokenError(
      `token is for hook ${String(claims.hook)}, not ${options.hook}`
    );
  }
  return claims;
}

/** Signature, issuer, audience and time: everything the kinds share. */
async function verifyInitiativeToken(
  token: string,
  options: VerifyOptions
): Promise<InitiativeTokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new ContextTokenError("not a JWT");
  }
  const [rawHeader, rawPayload, rawSignature] = parts;

  const header = decodeJson(rawHeader) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") {
    throw new ContextTokenError(`unexpected algorithm ${header.alg}`);
  }
  if (!header.kid) {
    throw new ContextTokenError("token names no key");
  }

  const key = await options.jwks.keyFor(options.baseUrl, header.kid);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${rawHeader}.${rawPayload}`);
  verifier.end();
  if (!verifier.verify(key, Buffer.from(rawSignature, "base64url"))) {
    throw new ContextTokenError("signature did not verify");
  }

  const claims = decodeJson(rawPayload) as InitiativeTokenClaims;
  const expected = audienceFor(options.publicId);
  if (claims.aud !== expected) {
    throw new ContextTokenError(`token is for ${claims.aud}, not ${expected}`);
  }
  const issuer = options.issuer ?? INITIATIVE_ISSUER;
  if (claims.iss !== issuer) {
    throw new ContextTokenError(`token is from ${claims.iss}, not ${issuer}`);
  }

  const seconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const leeway = options.leewaySeconds ?? 30;
  if (typeof claims.exp !== "number" || claims.exp + leeway < seconds) {
    throw new ContextTokenError("token has expired");
  }
  if (typeof claims.iat === "number" && claims.iat - leeway > seconds) {
    throw new ContextTokenError("token is not valid yet");
  }
  return claims;
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf-8"));
  } catch {
    throw new ContextTokenError("not a JWT");
  }
}

/**
 * The `Authorization: Bearer …` value out of a request's headers, or null.
 * It does no verification of its own.
 */
export function bearerToken(
  headers: Record<string, string | string[] | undefined>
): string | null {
  const raw = headers.authorization ?? headers.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  return token || null;
}
