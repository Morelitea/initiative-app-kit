/**
 * Verifying the context token Initiative presents when it calls your app.
 *
 * A context token is the smallest thing that can work: it names one guild, one
 * install and one scope, and lives about a minute. Two consequences shape this
 * module.
 *
 * **It carries no person.** There is no `sub`, no email, no name. Where a call
 * needs a member's own credential at your vendor, the token carries
 * `connection_refs` — opaque handles you minted nothing of and can look up in
 * your own store. You select the right credential while learning nothing about
 * whose it is, and the same person is uncorrelated across apps.
 *
 * **Its audience is you.** `aud` is `initiative-app:<your public id>`, so a
 * token minted for another app does not verify here even if it is handed over.
 * Always pass your own `publicId` — verification without an audience check is
 * the one mistake that makes the claim meaningless.
 *
 * Keys come from the deployment's JWKS at
 * `/api/v1/app-platform/jwks.json`, cached by `kid`. An operator rotating the
 * platform keypair publishes both entries, so a cache miss refetches once
 * rather than failing.
 */

import { createPublicKey, createVerify, type KeyObject } from "node:crypto";

/** What a token may authorize. Pinned per call. */
export type ContextScope = "data" | "action" | "lifecycle";

/** Where the deployment publishes its verification keys. */
export const JWKS_PATH = "/api/v1/app-platform/jwks.json";

/** How long a fetched key set is reused before a refetch is considered. */
export const JWKS_CACHE_SECONDS = 300;

export interface ContextClaims {
  jti: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  /** The one guild this call is about. */
  guild_id: number;
  /** The install within that guild. */
  app_install_id: number;
  scope: ContextScope;
  /** Present when the scope is `data`. */
  source_id?: string;
  /** Present when the scope is `action`. */
  action_id?: string;
  /**
   * Connection id → the opaque handle you know that member's credential by.
   * Present only where the call depends on a per-member credential.
   */
  connection_refs?: Record<string, string>;
}

export class ContextTokenError extends Error {}

/** The audience a token for `publicId` must name. */
export function audienceFor(publicId: string): string {
  return `initiative-app:${publicId}`;
}

interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
}

interface CacheEntry {
  keys: Map<string, KeyObject>;
  fetchedAt: number;
  /** Whether this set is already the answer to a miss inside its own window. */
  refetched: boolean;
}

/**
 * Fetches and caches published verification keys.
 *
 * Cached per **document**, not per deployment: a deployment publishes its own
 * signing key at {@link JWKS_PATH} and each delegate's at an address of its
 * own, and those sets say different things. Keeping them apart is what stops a
 * delegate's key verifying a token claiming to be Initiative's.
 *
 * One instance is enough for all of them. An app verifying both context tokens
 * and delegate calls builds one cache and passes a `path` per call.
 */
export class JwksCache {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly options: {
      /** Injectable for tests and for a runtime with its own fetch. */
      fetchImpl?: typeof fetch;
      now?: () => number;
      cacheSeconds?: number;
      /** Which document to read. Defaults to {@link JWKS_PATH}. */
      path?: string;
    } = {}
  ) {}

  /**
   * The key for `kid`, fetching the set if it is unknown or stale.
   *
   * `path` names which document to read, defaulting to the one this cache was
   * built for. Pass it per call where the address varies — a delegate's key set
   * is addressed by which delegate it belongs to.
   */
  async keyFor(baseUrl: string, kid: string, path?: string): Promise<KeyObject> {
    const document = new URL(path ?? this.path(), baseUrl).toString();
    const entry = this.cache.get(document);
    const now = this.options.now?.() ?? Date.now();
    const ttl = (this.options.cacheSeconds ?? JWKS_CACHE_SECONDS) * 1000;
    const fresh = entry !== undefined && now - entry.fetchedAt < ttl;

    if (fresh) {
      const cached = entry!.keys.get(kid);
      if (cached) return cached;
      // A miss against a set that was *already* refetched to answer a miss.
      // Looking a third time in one window cannot produce a key the last two
      // fetches did not, and a caller presenting unknown kids would otherwise
      // decide how often this app calls the deployment.
      if (entry!.refetched) return missing(document, entry!.keys, kid);
    }
    // Unknown kid, or a stale set: refetch once. A rotation publishes both
    // generations in one document, so this resolves rather than flapping.
    const keys = await this.load(document);
    // Cached whatever came back, an empty set included. A document with no keys
    // is a real state — a delegate that holds the grant but has not been
    // provisioned a key yet publishes exactly that — and treating it as a
    // failure to cache would mean a fetch per presented token for as long as it
    // stays true.
    this.cache.set(document, { keys, fetchedAt: now, refetched: fresh });
    const found = keys.get(kid);
    if (!found) return missing(document, keys, kid);
    return found;
  }

  private path(): string {
    return this.options.path ?? JWKS_PATH;
  }

  private async load(document: string): Promise<Map<string, KeyObject>> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const response = await doFetch(document);
    // A 404 is cached as an empty set rather than raised as a fetch failure.
    // Where the address carries a name a caller supplied, a document that does
    // not exist is an ordinary answer, and re-asking for it on every attempt
    // would let that caller decide how often this app calls the deployment.
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

/**
 * The same refusal wherever a lookup comes up empty. Never returns.
 *
 * One sentence for "no such document", "no keys yet" and "no such key", on
 * purpose: the first two are the deployment's own wiring, and an unauthenticated
 * caller learning which of them applies learns something about the deployment
 * rather than about its own request.
 */
function missing(document: string, keys: Map<string, unknown>, kid: string): never {
  throw new ContextTokenError(
    keys.size === 0
      ? `${document} published no keys`
      : `no verification key published for kid ${kid}`
  );
}

/**
 * Verify a context token and return its claims.
 *
 * Checks the signature against the deployment's published key, then the
 * audience, the issuer if one is given, and expiry. Everything is checked —
 * a partial verification is worse than none, because it reads as a check.
 */
export async function verifyContextToken(
  token: string,
  options: {
    /** Your app's public id. The audience must name it. */
    publicId: string;
    /** The deployment calling you, for key lookup. */
    baseUrl: string;
    jwks: JwksCache;
    /** Pin the issuer when you know it. */
    issuer?: string;
    now?: () => number;
    /** Tolerance for clock skew, in seconds. */
    leewaySeconds?: number;
  }
): Promise<ContextClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new ContextTokenError("not a JWT");
  }
  const [rawHeader, rawPayload, rawSignature] = parts;

  const header = decodeJson(rawHeader) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") {
    // Named rather than guessed: an unexpected algorithm is the classic way a
    // token gets accepted on terms the issuer never intended.
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

  const claims = decodeJson(rawPayload) as ContextClaims;
  const expected = audienceFor(options.publicId);
  if (claims.aud !== expected) {
    throw new ContextTokenError(`token is for ${claims.aud}, not ${expected}`);
  }
  if (options.issuer && claims.iss !== options.issuer) {
    throw new ContextTokenError(`token is from ${claims.iss}, not ${options.issuer}`);
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
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf-8"));
}

/**
 * The `Authorization: Bearer …` value out of a request's headers, or null.
 *
 * A convenience so every handler does not restate the parsing; it does no
 * verification of its own.
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
