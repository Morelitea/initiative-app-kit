/**
 * Getting tokens from Initiative, and calling it with them.
 *
 * Initiative is an OAuth 2.0 authorization server for apps. An app
 * authenticates with its own key (`private_key_jwt`, RFC 7523) and asks one
 * endpoint, `POST {baseUrl}/app-platform/oauth/token`, for one of three tokens:
 *
 * | Token | Grant | What it is for |
 * |---|---|---|
 * | App token | `client_credentials`, no installation | Listing where the app is installed. Nothing else. |
 * | Installation token | `client_credentials` + `installation` | Acting as the community that installed the app, with the scopes it granted. |
 * | Member token | `jwt-bearer` (RFC 7523 §2.1) | Acting for one member, for a purpose that member consented to. |
 *
 * Either community token can be narrowed: `scopes` asks for a subset of what
 * was granted (RFC 6749 §3.3), and `initiativeId` confines it to one initiative
 * the app is placed in (RFC 8707 resource indicator).
 *
 * **Tokens are opaque.** Never decode one; what a token carries is Initiative's
 * business. The token response says how long it lives and which scopes it
 * holds, and that is all an app needs.
 *
 * Tokens are cached until 30 seconds before they expire, per kind,
 * installation, member, purpose, scope set and initiative. Concurrent requests
 * for the same token share one call to the token endpoint.
 */

import { randomUUID, type KeyObject } from "node:crypto";

import type { Scope } from "./contract.js";
import {
  algorithmOf,
  loadPrivateKey,
  signJwt,
  type AppKeyAlgorithm,
  type AppSigningKey,
} from "./keys.js";
import { stripTrailingSlashes } from "./parse.js";

/** `client_assertion_type` for `private_key_jwt` (RFC 7523 §2.2). */
export const CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

/** The JWT-bearer authorization grant (RFC 7523 §2.1), used for member tokens. */
export const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

/** How long each signed assertion lives, in seconds. */
export const ASSERTION_LIFETIME_SECONDS = 60;

/** A cached token is renewed this many seconds before it expires. */
export const TOKEN_EXPIRY_SKEW_SECONDS = 30;

/** The value the SDK writes in the `/c/{guild}` segment of a community route. */
export const GUILD_PATH_PLACEHOLDER = "0";

/**
 * A community route's path, ready for {@link InitiativeAuth.fetchAsInstallation}.
 *
 * Every community route in Initiative's API is addressed `/c/{guild}/…`. For an
 * app's installation or member token the community comes from the token, and
 * that segment is not read. It must still be a whole number, so the SDK always
 * writes `0`, which names no community:
 *
 * ```ts
 * guildPath("/projects/")  // "/c/0/projects/"
 * ```
 */
export function guildPath(path: string): string {
  const rooted = path.startsWith("/") ? path : `/${path}`;
  if (rooted === "/c" || rooted.startsWith("/c/")) {
    throw new TypeError(`guildPath takes the path after /c/{guild}, not ${path}`);
  }
  return `/c/${GUILD_PATH_PLACEHOLDER}${rooted}`;
}

/** The resource indicator naming one initiative (RFC 8707). */
export function initiativeResource(initiativeId: number): string {
  if (!Number.isInteger(initiativeId) || initiativeId <= 0) {
    throw new TypeError(`an initiative id is a positive whole number, not ${initiativeId}`);
  }
  return `urn:initiative:initiative:${initiativeId}`;
}

export interface InitiativeAuthOptions {
  /** The deployment's API base, e.g. `https://initiative.example.com/api/v1`. */
  baseUrl: string;
  /** Your app's public id: the OAuth client id. */
  clientId: string;
  /** Your private key, as PEM or a loaded key. */
  privateKey: string | KeyObject;
  /** The `kid` the deployment registered this key under. */
  kid: string;
  /** Checked against the key's type when given. Otherwise read from the key. */
  alg?: AppKeyAlgorithm;
  /** Injectable for tests and for runtimes with their own fetch. */
  fetch?: typeof fetch;
  /** Milliseconds since the epoch. Defaults to `Date.now`. */
  clock?: () => number;
}

/** A token, as the token endpoint issued it. */
export interface AccessToken {
  /** The bearer value. Opaque: send it, never read it. */
  token: string;
  /** The scopes it holds, from the token response. */
  scopes: string[];
  /** When it expires, in milliseconds since the epoch. */
  expiresAt: number;
}

/** Narrowing for a community token. */
export interface TokenNarrowing {
  /** A subset of the scopes the community granted. Absent: all of them. */
  scopes?: readonly Scope[];
  /** Confine the token to one initiative the app is placed in. */
  initiativeId?: number;
}

export interface InstallationTokenRequest extends TokenNarrowing {
  /** The installation's reference, as {@link InitiativeAuth.listInstallations} returns it. */
  installation: string;
}

export interface MemberTokenRequest extends TokenNarrowing {
  installation: string;
  /** The member's reference for this installation. */
  member: string;
  /** The purpose the member consented to. Absent: app-wide consent. */
  purpose?: string;
}

/** One community that has installed your app. */
export interface Installation {
  /** Its reference. Pass it as `installation` to get a token for it. */
  installation: string;
  /** The scopes the community granted. */
  scopes: string[];
  /** The initiatives the app is placed in. */
  initiatives: number[];
}

export interface ConsentRequest {
  installation: string;
  /** The member's reference for this installation. */
  member: string;
  /**
   * Your own id for what the member is consenting to, such as one automation
   * step. Absent: consent for the whole app.
   */
  purpose?: string;
  /** Shown to the member as your app's own words. */
  label: string;
  /** Bind the consent to one initiative. */
  initiativeId?: number;
  /** What you ask for. The member may grant less. */
  access: "read" | "read_write";
}

/** An OAuth error from the token endpoint (RFC 6749 §5.2). */
export class InitiativeAuthError extends Error {
  constructor(
    /** The RFC 6749 error code: `invalid_client`, `invalid_grant`, `invalid_scope`, … */
    readonly error: string,
    readonly errorDescription: string | undefined,
    /** The HTTP status the token endpoint answered with. */
    readonly status: number
  ) {
    super(errorDescription ? `${error}: ${errorDescription}` : error);
    this.name = "InitiativeAuthError";
  }
}

/**
 * The member has not consented to this purpose, or has withdrawn consent, or
 * can no longer be acted for. Ask again with
 * {@link InitiativeAuth.requestConsent}, or mark the work as needing consent.
 */
export class ConsentRequiredError extends InitiativeAuthError {
  constructor(errorDescription: string | undefined, status: number) {
    super("consent_required", errorDescription, status);
    this.name = "ConsentRequiredError";
  }
}

/** A non-OAuth call to Initiative answered with an error status. */
export class InitiativeApiError extends Error {
  constructor(
    readonly status: number,
    /** Initiative's machine-readable `detail`, when the body carried one. */
    readonly detail: unknown
  ) {
    super(`Initiative answered ${status}${typeof detail === "string" ? `: ${detail}` : ""}`);
    this.name = "InitiativeApiError";
  }
}

type TokenKind = "app" | "installation" | "member";

/** Tokens from Initiative for one app, with caching. */
export class InitiativeAuth {
  /** The exact token endpoint URL, which is also every assertion's `aud`. */
  readonly tokenEndpoint: string;
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly signing: AppSigningKey;
  private readonly doFetch: typeof fetch;
  private readonly clock: () => number;
  private readonly cache = new Map<string, AccessToken>();
  private readonly inflight = new Map<string, Promise<AccessToken>>();

  constructor(options: InitiativeAuthOptions) {
    if (!options.clientId) throw new TypeError("clientId is your app's public id");
    this.baseUrl = stripTrailingSlashes(options.baseUrl);
    this.tokenEndpoint = `${this.baseUrl}/app-platform/oauth/token`;
    this.clientId = options.clientId;
    const signing =
      typeof options.privateKey === "string"
        ? loadPrivateKey(options.privateKey, options.kid)
        : { key: options.privateKey, kid: options.kid, alg: algorithmOf(options.privateKey) };
    if (!signing.kid) throw new TypeError("kid names the registered key");
    if (options.alg && options.alg !== signing.alg) {
      throw new TypeError(`alg ${options.alg} does not match a key that signs ${signing.alg}`);
    }
    this.signing = signing;
    this.doFetch = options.fetch ?? fetch;
    this.clock = options.clock ?? Date.now;
  }

  /** A token for the app itself, with no installation. */
  async appToken(): Promise<AccessToken> {
    return this.cached(cacheKey(["app"]), () =>
      this.requestToken(this.clientCredentials(), undefined)
    );
  }

  /** A token that acts as the community that installed the app. */
  async installationToken(request: InstallationTokenRequest): Promise<AccessToken> {
    const installation = required(request.installation, "installation");
    const scopes = normalizeScopes(request.scopes);
    return this.cached(
      installationKey(installation, scopes, request.initiativeId),
      () =>
        this.requestToken(
          [
            ...this.clientCredentials(),
            ["installation", installation],
            ...narrowing(scopes, request.initiativeId),
          ],
          scopes
        )
    );
  }

  /**
   * A token that acts for one member, within what they consented to.
   *
   * Throws {@link ConsentRequiredError} when there is no live consent for this
   * member and purpose.
   */
  async memberToken(request: MemberTokenRequest): Promise<AccessToken> {
    const installation = required(request.installation, "installation");
    const member = required(request.member, "member");
    const scopes = normalizeScopes(request.scopes);
    const purpose = request.purpose ?? "";
    return this.cached(
      cacheKey(["member", installation, member, purpose, scopes.join(" "), request.initiativeId ?? ""]),
      () => {
        const assertion = this.assertion(member, {
          installation,
          ...(request.purpose !== undefined ? { purpose: request.purpose } : {}),
        });
        return this.requestToken(
          [
            ["grant_type", JWT_BEARER_GRANT],
            ["assertion", assertion],
            ...narrowing(scopes, request.initiativeId),
          ],
          scopes
        );
      }
    );
  }

  /** Every community that has installed the app, with its grants and placements. */
  async listInstallations(): Promise<Installation[]> {
    const { token } = await this.appToken();
    const response = await this.doFetch(`${this.baseUrl}/app-platform/installations`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const body = await readJson(response);
    if (!response.ok) throw new InitiativeApiError(response.status, detailOf(body));
    if (!Array.isArray(body)) {
      throw new InitiativeApiError(response.status, "installations: expected an array");
    }
    return body.map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        installation: String(item.installation ?? ""),
        scopes: Array.isArray(item.scopes) ? item.scopes.map(String) : [],
        initiatives: Array.isArray(item.initiatives) ? item.initiatives.map(Number) : [],
      };
    });
  }

  /**
   * Ask a member to let the app act for them.
   *
   * The member is notified and answers on Initiative's own consent screen.
   * Asking again for the same member and purpose returns the existing request.
   * Returns Initiative's answer as it sent it.
   */
  async requestConsent(request: ConsentRequest): Promise<Record<string, unknown>> {
    const installation = required(request.installation, "installation");
    const body: Record<string, unknown> = {
      member: required(request.member, "member"),
      label: required(request.label, "label"),
      access: request.access,
    };
    if (request.purpose !== undefined) body.purpose = request.purpose;
    if (request.initiativeId !== undefined) {
      initiativeResource(request.initiativeId);
      body.initiative_id = request.initiativeId;
    }
    const response = await this.fetchAsInstallation(
      installation,
      "/app-platform/consent-requests",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      }
    );
    const answer = await readJson(response);
    if (!response.ok) throw new InitiativeApiError(response.status, detailOf(answer));
    return (answer ?? {}) as Record<string, unknown>;
  }

  /**
   * `fetch` against the deployment's API with an installation token.
   *
   * `path` is relative to `baseUrl`. Build a community route with
   * {@link guildPath}. A 401 drops the cached token, so the next call gets a
   * fresh one.
   */
  async fetchAsInstallation(
    installation: string,
    path: string,
    init: RequestInit = {},
    narrowingOptions: TokenNarrowing = {}
  ): Promise<Response> {
    const request = { installation, ...narrowingOptions };
    const { token } = await this.installationToken(request);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const rooted = path.startsWith("/") ? path : `/${path}`;
    const response = await this.doFetch(`${this.baseUrl}${rooted}`, { ...init, headers });
    if (response.status === 401) {
      this.cache.delete(
        installationKey(installation, normalizeScopes(request.scopes), request.initiativeId)
      );
    }
    return response;
  }

  /** Forget every cached token. */
  clear(): void {
    this.cache.clear();
  }

  // --- internals ------------------------------------------------------------

  private clientCredentials(): Array<[string, string]> {
    return [
      ["grant_type", "client_credentials"],
      ["client_assertion_type", CLIENT_ASSERTION_TYPE],
      ["client_assertion", this.assertion(this.clientId, {})],
    ];
  }

  /** A signed assertion addressed to the token endpoint. */
  private assertion(subject: string, extra: Record<string, string>): string {
    const iat = Math.floor(this.clock() / 1000);
    return signJwt(this.signing, {
      iss: this.clientId,
      sub: subject,
      aud: this.tokenEndpoint,
      jti: randomUUID(),
      iat,
      exp: iat + ASSERTION_LIFETIME_SECONDS,
      ...extra,
    });
  }

  private async cached(key: string, issue: () => Promise<AccessToken>): Promise<AccessToken> {
    const hit = this.cache.get(key);
    if (hit && this.clock() < hit.expiresAt - TOKEN_EXPIRY_SKEW_SECONDS * 1000) return hit;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const request = (async () => {
      try {
        const token = await issue();
        this.cache.set(key, token);
        return token;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, request);
    return request;
  }

  private async requestToken(
    form: Array<[string, string]>,
    requested: string[] | undefined
  ): Promise<AccessToken> {
    const issuedAt = this.clock();
    const response = await this.doFetch(this.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
    });
    const body = (await readJson(response)) as Record<string, unknown> | null;

    if (!response.ok) {
      const error = typeof body?.error === "string" ? body.error : "invalid_response";
      const description =
        typeof body?.error_description === "string"
          ? body.error_description
          : typeof body?.error === "string"
            ? undefined
            : `token endpoint answered ${response.status}`;
      if (error === "consent_required") throw new ConsentRequiredError(description, response.status);
      throw new InitiativeAuthError(error, description, response.status);
    }
    if (typeof body?.access_token !== "string" || !body.access_token) {
      throw new InitiativeAuthError(
        "invalid_response",
        "token response carried no access_token",
        response.status
      );
    }
    if (typeof body.token_type === "string" && body.token_type.toLowerCase() !== "bearer") {
      throw new InitiativeAuthError(
        "invalid_response",
        `unexpected token_type ${body.token_type}`,
        response.status
      );
    }
    const lifetime =
      typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0
        ? body.expires_in
        : 0;
    return {
      token: body.access_token,
      scopes:
        typeof body.scope === "string"
          ? body.scope.split(" ").filter(Boolean)
          : [...(requested ?? [])],
      expiresAt: issuedAt + lifetime * 1000,
    };
  }
}

/** One cache entry per kind, installation, member, purpose, scope set and initiative. */
function cacheKey(parts: [TokenKind, ...Array<string | number>]): string {
  return JSON.stringify(parts);
}

function installationKey(
  installation: string,
  scopes: string[],
  initiativeId: number | undefined
): string {
  return cacheKey(["installation", installation, "", "", scopes.join(" "), initiativeId ?? ""]);
}

function required(value: string | undefined, name: string): string {
  if (typeof value !== "string" || !value) throw new TypeError(`${name} is required`);
  return value;
}

/** Sorted and de-duplicated, so one scope set is one cache entry and one request. */
function normalizeScopes(scopes: readonly string[] | undefined): string[] {
  return [...new Set(scopes ?? [])].sort();
}

function narrowing(scopes: string[], initiativeId: number | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (scopes.length > 0) out.push(["scope", scopes.join(" ")]);
  if (initiativeId !== undefined) out.push(["resource", initiativeResource(initiativeId)]);
  return out;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function detailOf(body: unknown): unknown {
  return body && typeof body === "object" && "detail" in body
    ? (body as { detail: unknown }).detail
    : body;
}
