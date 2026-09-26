/**
 * Initiative, as an app reaches it.
 *
 * An app authenticates with its own key (`private_key_jwt`, RFC 7523) at
 * `POST {baseUrl}/app-platform/oauth/token` and acts with one of two tokens:
 *
 * - an **installation token** (`client_credentials` + `installation`), acting as
 *   the community that installed the app, with the scopes it granted;
 * - a **member token** (the JWT-bearer grant, RFC 7523 §2.1), acting for one
 *   member, within what that member consented to.
 *
 * Either can be narrowed to one initiative the app is placed in (RFC 8707) and
 * to fewer scopes (RFC 6749 §3.3). {@link Initiative.asInstallation} and
 * {@link Initiative.asMember} each give a {@link Client} acting that way; a
 * handler is handed one already acting for its call.
 *
 * Tokens are opaque and never read. The token response says how long each
 * lives and which scopes it holds: a call needing a scope the token does not
 * hold fails before it is sent, naming the scope. Tokens are cached until 30
 * seconds before they expire, concurrent callers share one request, and a
 * call answered 401 is sent once more on a fresh token.
 */

import { randomUUID } from "node:crypto";

import type { ActorKind, AppScope, Scope } from "./contract.js";
import type { Actor } from "./define.js";
import { signJwt, type AppSigningKey } from "./keys.js";

export {
  generateAppKeys,
  loadPrivateKey,
  publicJwks,
  type AppKeyAlgorithm,
  type AppSigningKey,
  type GeneratedAppKeys,
  type Jwks,
  type PublicJwk,
} from "./keys.js";

const CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const ASSERTION_LIFETIME_SECONDS = 60;
const TOKEN_EXPIRY_SKEW_SECONDS = 30;

/**
 * Community routes are addressed `/c/{guild}/…`. With an app's token the
 * community is the token's and the segment is not read, so the client always
 * writes `0` there.
 */
const COMMUNITY_PREFIX = "/c/0";

export interface InitiativeOptions {
  /** The deployment's API base, such as `https://initiative.example.com/api/v1`. */
  baseUrl: string;
  /** The app's public id: its OAuth client id. */
  publicId: string;
  /** The app's key, as `loadPrivateKey` gives it. */
  key: AppSigningKey;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch. */
  now?: () => number;
}

/** Narrowing for a token: fewer scopes than were granted, and one initiative. */
export interface Narrowing {
  scopes?: ReadonlyArray<Scope | AppScope>;
  initiative?: number;
}

export interface MemberOptions extends Narrowing {
  /** The purpose the member consented to. Absent: consent to the whole app. */
  purpose?: string;
}

/** One community that has installed the app. */
export interface Installation {
  installation: string;
  /** False while it is switched off or its community is on hold: keep what you hold for it. */
  active: boolean;
}

/** What another app answered, through Initiative. */
export interface InvokeOutcome {
  endpoint: string;
  actor: ActorKind;
  result: Record<string, unknown>;
}

/** One member's stored values, by the handle the app knows. */
export interface MemberConnectionConfig {
  connectionId: string;
  connectionRef: string;
  status: string;
  values: Record<string, unknown>;
}

/**
 * The installation's configuration: each community-wide connection's values
 * and the managed values of each member's. Vendor tokens are never in it; ask
 * for one with {@link Client.connectionToken}. Hold it in memory only.
 */
export interface InstallationConfig {
  guildRef: string;
  installId: number;
  listingUid: string;
  listingVersion: string;
  enabled: boolean;
  /** The app's last verdict on this configuration: `unverified`, `ok` or `invalid`. */
  configState: string;
  configStateDetail: string | null;
  /** Whether an admin still has a community-wide connection to fill in. */
  needsConfig: boolean;
  /** Connection id → field key → value. */
  connections: Record<string, Record<string, unknown>>;
  /** Connection id → the handle of each community-wide connection that has one. */
  connectionRefs: Record<string, string>;
  memberConnections: MemberConnectionConfig[];
}

/** One member's connection, with its state and no values. */
export interface InstallationConnection {
  connectionId: string;
  connectionRef: string;
  status: string;
  blocked: boolean;
  accountLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A vendor access token for one connection. Send it to the vendor; never store it. */
export interface ConnectionAccessToken {
  accessToken: string;
  /** Milliseconds since the epoch, or null when the vendor did not say. */
  expiresAt: number | null;
}

export interface ConfigStatusReport {
  state: "ok" | "invalid";
  /** A short code shown beside `invalid`, such as `missing_scope`. */
  detail?: string;
}

export interface ConfigStatus {
  guildRef: string;
  installId: number;
  configState: string;
  configStateDetail: string | null;
}

export interface InstallationEvent {
  /** An `emit` endpoint the app declares, by its manifest id. */
  eventType: string;
  /** At most 8 KiB as JSON. */
  payload?: Record<string, unknown>;
  /** The initiative the event is about, when it is about one. */
  initiativeId?: number;
}

export interface ConsentRequest {
  member: string;
  /** The app's own id for what the member is consenting to. Absent: the whole app. */
  purpose?: string;
  /** Shown to the member as the app's own words. */
  label: string;
  initiativeId?: number;
  /** What the app asks for. The member may grant less. */
  access: "read" | "read_write";
}

/** The token endpoint refused (RFC 6749 §5.2). */
export class InitiativeAuthError extends Error {
  constructor(
    /** `invalid_client`, `invalid_grant`, `invalid_scope`, … */
    readonly error: string,
    readonly errorDescription: string | undefined,
    readonly status: number
  ) {
    super(errorDescription ? `${error}: ${errorDescription}` : error);
    this.name = "InitiativeAuthError";
  }
}

/** The member has not consented to this purpose, or no longer can be acted for. */
export class ConsentRequiredError extends InitiativeAuthError {
  constructor(errorDescription: string | undefined, status: number) {
    super("consent_required", errorDescription, status);
    this.name = "ConsentRequiredError";
  }
}

/** A call to Initiative answered with an error status. */
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

/** A call needs a scope the token does not hold. Nothing was sent. */
export class MissingScopeError extends Error {
  constructor(readonly scope: string) {
    super(`this call needs ${scope}, which the token does not hold`);
    this.name = "MissingScopeError";
  }
}

/** Whether `held` covers `scope`. Writing implies reading. */
export function grants(held: readonly string[], scope: string): boolean {
  if (held.includes(scope)) return true;
  return scope.endsWith(":read") && held.includes(`${scope.slice(0, -":read".length)}:write`);
}

interface Grant {
  installation: string;
  member?: string;
  purpose?: string;
  scopes: string[];
  initiative?: number;
}

interface AccessToken {
  token: string;
  scopes: string[];
  expiresAt: number;
}

/** Issues, caches and spends the app's tokens. */
class Tokens {
  readonly baseUrl: string;
  readonly endpoint: string;
  private readonly cache = new Map<string, AccessToken>();
  private readonly inflight = new Map<string, Promise<AccessToken>>();
  readonly fetch: typeof fetch;
  readonly now: () => number;

  constructor(private readonly options: InitiativeOptions) {
    if (!options.publicId) throw new TypeError("publicId is the app's public id");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.endpoint = `${this.baseUrl}/app-platform/oauth/token`;
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** A token for the grant, from the cache while it is fresh. */
  token(grant: Grant | null): Promise<AccessToken> {
    const key = JSON.stringify(grant);
    const hit = this.cache.get(key);
    if (hit && this.now() < hit.expiresAt - TOKEN_EXPIRY_SKEW_SECONDS * 1000) return Promise.resolve(hit);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const request = this.issue(grant)
      .then((token) => {
        this.cache.set(key, token);
        return token;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  /**
   * `fetch` against the API on the grant's token. A 401 drops the token and the
   * call is sent once more on a fresh one.
   */
  async send(grant: Grant | null, url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const { token } = await this.token(grant);
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      const response = await this.fetch(url.startsWith("http") ? url : `${this.baseUrl}${url}`, { ...init, headers });
      if (response.status !== 401 || attempt > 0) return response;
      this.cache.delete(JSON.stringify(grant));
    }
  }

  private async issue(grant: Grant | null): Promise<AccessToken> {
    const form: Array<[string, string]> = [];
    if (grant?.member !== undefined) {
      form.push(
        ["grant_type", JWT_BEARER_GRANT],
        [
          "assertion",
          this.assertion(grant.member, {
            installation: grant.installation,
            ...(grant.purpose !== undefined ? { purpose: grant.purpose } : {}),
          }),
        ]
      );
    } else {
      form.push(
        ["grant_type", "client_credentials"],
        ["client_assertion_type", CLIENT_ASSERTION_TYPE],
        ["client_assertion", this.assertion(this.options.publicId, {})]
      );
      if (grant) form.push(["installation", grant.installation]);
    }
    if (grant?.scopes.length) form.push(["scope", grant.scopes.join(" ")]);
    if (grant?.initiative !== undefined) form.push(["resource", `urn:initiative:initiative:${grant.initiative}`]);

    const issuedAt = this.now();
    const response = await this.fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
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
      throw new InitiativeAuthError("invalid_response", "token response carried no access_token", response.status);
    }
    if (typeof body.token_type === "string" && body.token_type.toLowerCase() !== "bearer") {
      throw new InitiativeAuthError("invalid_response", `unexpected token_type ${body.token_type}`, response.status);
    }
    const lifetime = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 0;
    return {
      token: body.access_token,
      scopes: typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean) : [...(grant?.scopes ?? [])],
      expiresAt: issuedAt + lifetime * 1000,
    };
  }

  /** A signed assertion addressed to the token endpoint. */
  private assertion(subject: string, extra: Record<string, string>): string {
    const iat = Math.floor(this.now() / 1000);
    return signJwt(this.options.key, {
      iss: this.options.publicId,
      sub: subject,
      aud: this.endpoint,
      jti: randomUUID(),
      iat,
      exp: iat + ASSERTION_LIFETIME_SECONDS,
      ...extra,
    });
  }
}

/** Initiative, for one app on one deployment. */
export class Initiative {
  private readonly tokens: Tokens;

  constructor(options: InitiativeOptions) {
    this.tokens = new Tokens(options);
  }

  /**
   * Every community that has installed the app, following Initiative's
   * `Link` pages to the end. One that is gone is not listed.
   */
  async installations(): Promise<Installation[]> {
    const installations: Installation[] = [];
    let url: string | null = `${this.tokens.baseUrl}/app-platform/installations`;
    while (url !== null) {
      const response: Response = await this.tokens.send(null, url, { headers: { Accept: "application/json" } });
      const body = await readJson(response);
      if (!response.ok) throw new InitiativeApiError(response.status, detailOf(body));
      if (!Array.isArray(body)) throw new InitiativeApiError(response.status, "installations: expected an array");
      for (const item of body as Array<Record<string, unknown>>) {
        installations.push({ installation: String(item.installation ?? ""), active: item.active !== false });
      }
      const next = nextLink(response.headers.get("link"));
      url = next === null ? null : new URL(next, url).toString();
    }
    return installations;
  }

  /** The app acting as the community that installed it. */
  asInstallation(installation: string, narrowing: Narrowing = {}): Client {
    return new Client(this.tokens, grantOf(installation, narrowing));
  }

  /** The app acting for one member, within what they consented to. */
  asMember(installation: string, member: string, options: MemberOptions = {}): Client {
    if (!member) throw new TypeError("member is required");
    return new Client(this.tokens, {
      ...grantOf(installation, options),
      member,
      ...(options.purpose !== undefined ? { purpose: options.purpose } : {}),
    });
  }
}

function grantOf(installation: string, narrowing: Narrowing): Grant {
  if (!installation) throw new TypeError("installation is required");
  const initiative = narrowing.initiative;
  if (initiative !== undefined && (!Number.isInteger(initiative) || initiative <= 0)) {
    throw new TypeError(`an initiative id is a positive whole number, not ${initiative}`);
  }
  return {
    installation,
    scopes: [...new Set(narrowing.scopes ?? [])].sort(),
    ...(initiative !== undefined ? { initiative } : {}),
  };
}

/**
 * Initiative, acting as one actor in one installation.
 *
 * Content calls ({@link Client.request}, {@link Client.callApp}) go on the
 * actor's own token. The installation's own configuration, connections, status
 * and events go on the installation's token, narrowed to the same initiative.
 */
export class Client {
  constructor(
    private readonly tokens: Tokens,
    private readonly grant: Grant
  ) {}

  get installation(): string {
    return this.grant.installation;
  }

  get actor(): Actor {
    return this.grant.member === undefined
      ? { kind: "installation" }
      : { kind: "member", member: this.grant.member };
  }

  get initiative(): number | null {
    return this.grant.initiative ?? null;
  }

  /** The scopes the actor's token holds. */
  async scopes(): Promise<string[]> {
    return (await this.tokens.token(this.grant)).scopes;
  }

  /**
   * One call to a community route, the path after `/c/{guild}`, on the actor's
   * token. It is not sent unless the token holds `scope`. Answers the parsed
   * JSON body, or throws {@link InitiativeApiError}.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    options: { scope: Scope | AppScope; body?: unknown }
  ): Promise<T> {
    return (await this.call(method, `${COMMUNITY_PREFIX}${path.startsWith("/") ? path : `/${path}`}`, options)) as T;
  }

  /**
   * Call another app's public endpoint through Initiative, as this actor. Needs
   * `apps:<publicId>`. A write is sent once and never retried by Initiative.
   */
  async callApp(publicId: string, endpointId: string, params: Record<string, unknown> = {}): Promise<InvokeOutcome> {
    const path = `/app-platform/apps/${encodeURIComponent(publicId)}/endpoints/${encodeURIComponent(endpointId)}`;
    const body = await this.call("POST", path, { scope: `apps:${publicId}`, body: { params } });
    if (!isRecord(body) || !isRecord(body.result)) {
      throw new InitiativeApiError(200, "call: the app answered without a result");
    }
    return body as unknown as InvokeOutcome;
  }

  /** The installation's configuration. */
  async config(): Promise<InstallationConfig> {
    const body = (await this.installationCall("GET", "/config")) as Record<string, unknown>;
    return {
      guildRef: String(body.guild_ref ?? ""),
      installId: Number(body.install_id),
      listingUid: String(body.listing_uid ?? ""),
      listingVersion: String(body.listing_version ?? ""),
      enabled: body.enabled === true,
      configState: String(body.config_state ?? "unverified"),
      configStateDetail: nullableString(body.config_state_detail),
      needsConfig: body.needs_config === true,
      connections: isRecord(body.connections) ? (body.connections as Record<string, Record<string, unknown>>) : {},
      connectionRefs: isRecord(body.connection_refs)
        ? Object.fromEntries(
            Object.entries(body.connection_refs).filter((entry): entry is [string, string] => typeof entry[1] === "string")
          )
        : {},
      memberConnections: Array.isArray(body.member_connections)
        ? body.member_connections.map((raw: Record<string, unknown>) => ({
            connectionId: String(raw.connection_id ?? ""),
            connectionRef: String(raw.connection_ref ?? ""),
            status: String(raw.status ?? ""),
            values: isRecord(raw.values) ? raw.values : {},
          }))
        : [],
    };
  }

  /** The installation's member connections: which handles are live, with no values. */
  async connections(): Promise<InstallationConnection[]> {
    const body = (await this.installationCall("GET", "/connections")) as Record<string, unknown>;
    return Array.isArray(body.items)
      ? body.items.map((item: Record<string, unknown>) => ({
          connectionId: String(item.connection_id ?? ""),
          connectionRef: String(item.connection_ref ?? ""),
          status: String(item.status ?? ""),
          blocked: item.blocked === true,
          accountLabel: nullableString(item.account_label),
          createdAt: String(item.created_at ?? ""),
          updatedAt: String(item.updated_at ?? ""),
        }))
      : [];
  }

  /**
   * A usable vendor access token for one connection, by its handle. Initiative
   * refreshes it, or mints it for a `jwt_bearer` connection. Ask each time.
   */
  async connectionToken(connectionRef: string): Promise<ConnectionAccessToken> {
    if (!connectionRef) throw new TypeError("connectionRef is required");
    const body = (await this.installationCall(
      "POST",
      `/connections/${encodeURIComponent(connectionRef)}/token`
    )) as Record<string, unknown>;
    if (typeof body.access_token !== "string" || !body.access_token) {
      throw new InitiativeApiError(200, "connection token: no access_token");
    }
    return {
      accessToken: body.access_token,
      expiresAt: typeof body.expires_at === "number" ? body.expires_at * 1000 : null,
    };
  }

  /** Tell Initiative whether the configuration the app was handed works. */
  async reportConfigStatus(report: ConfigStatusReport): Promise<ConfigStatus> {
    const body = (await this.installationCall("POST", "/config-status", {
      state: report.state,
      ...(report.detail !== undefined ? { detail: report.detail } : {}),
    })) as Record<string, unknown>;
    return {
      guildRef: String(body.guild_ref ?? ""),
      installId: Number(body.install_id),
      configState: String(body.config_state ?? ""),
      configStateDetail: nullableString(body.config_state_detail),
    };
  }

  /** Emit one of the app's declared events, for Initiative to keep and deliver. */
  async emitEvent(event: InstallationEvent): Promise<void> {
    await this.installationCall("POST", "/events", {
      event_type: event.eventType,
      payload: event.payload ?? {},
      ...(event.initiativeId === undefined ? {} : { initiative_id: event.initiativeId }),
    });
  }

  /** Ask a member to let the app act for them, on Initiative's own consent screen. */
  async requestConsent(request: ConsentRequest): Promise<Record<string, unknown>> {
    const body = await this.send(this.installationGrant(), "POST", "/app-platform/consent-requests", {
      member: request.member,
      label: request.label,
      access: request.access,
      ...(request.purpose !== undefined ? { purpose: request.purpose } : {}),
      ...(request.initiativeId !== undefined ? { initiative_id: request.initiativeId } : {}),
    });
    return (body ?? {}) as Record<string, unknown>;
  }

  private installationGrant(): Grant {
    const { member: _member, purpose: _purpose, ...installation } = this.grant;
    return { ...installation, scopes: [] };
  }

  private async installationCall(method: string, path: string, payload?: Record<string, unknown>): Promise<unknown> {
    return (await this.send(this.installationGrant(), method, `/app-platform/installation${path}`, payload)) ?? {};
  }

  private async call(method: string, path: string, options: { scope: string; body?: unknown }): Promise<unknown> {
    const { scopes } = await this.tokens.token(this.grant);
    if (!grants(scopes, options.scope)) throw new MissingScopeError(options.scope);
    return this.send(this.grant, method, path, options.body);
  }

  private async send(grant: Grant, method: string, path: string, payload?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await this.tokens.send(grant, path, {
      method,
      headers,
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
    const body = await readJson(response);
    if (!response.ok) throw new InitiativeApiError(response.status, detailOf(body));
    return body;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** The `rel="next"` target of a `Link` header (RFC 8288), or null. */
function nextLink(header: string | null): string | null {
  for (const part of (header ?? "").split(",")) {
    const match = /^\s*<([^>]*)>\s*;\s*rel="?next"?\s*$/i.exec(part);
    if (match) return match[1] ?? null;
  }
  return null;
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
  return isRecord(body) && "detail" in body ? body.detail : body;
}
