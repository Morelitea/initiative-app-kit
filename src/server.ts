/**
 * The app's server: every route Initiative calls, answered from the app's
 * definition.
 *
 * | Route | Who calls it |
 * |---|---|
 * | `GET /healthz`, `GET /readyz` | the container runtime |
 * | `GET /.well-known/jwks.json` | a deployment that registers the app's key by address |
 * | `GET /.well-known/initiative-app.json` | a deployment reading the app's manifest document |
 * | `GET, POST /v1/endpoints` | Initiative, with a context token |
 * | `POST /v1/hooks/{name}` | Initiative, with a lifecycle token |
 * | a surface's path | a member's browser, inside Initiative's frame |
 *
 * {@link createApp} returns a web-standard handler, `(Request) => Promise<Response>`,
 * so the same app runs on any runtime that speaks `Request` and `Response`.
 * {@link serve} runs it on `node:http`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";

import type { ActorKind, Manifest } from "./contract.js";
import {
  endpointId,
  manifestOf,
  type AnyApp,
  type AppContext,
  type Call,
  type EndpointDeclaration,
  type Handoff,
  type ParamValue,
  type SurfaceDeclaration,
} from "./define.js";
import { Initiative } from "./client.js";
import { generateAppKeys, loadPrivateKey, publicJwks, type AppSigningKey } from "./keys.js";
import {
  ContextTokenError,
  JwksCache,
  verifyContextToken,
  verifyHandoffToken,
  verifyLifecycleToken,
  type VerifyOptions,
} from "./tokens.js";
import { appDocument, MANIFEST_PATH } from "./validate.js";

export type {
  Actor,
  AfterConnectAnswer,
  AfterConnectCall,
  AppContext,
  Call,
  EndpointCall,
  Handoff,
  Outcome,
  RevokeCall,
  ScheduleCall,
  SurfaceCall,
  WebhookCall,
} from "./define.js";

const ENDPOINTS_PATH = "/v1/endpoints";
const HOOKS_PATH = "/v1/hooks/";
const JWKS_ROUTE = "/.well-known/jwks.json";

/** The most a request body may carry. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * A handler's refusal: answered with `status` and `{ error: code, detail }`.
 * Anything else a handler throws is answered 500.
 */
export class EndpointError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "EndpointError";
  }
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export type AppOptions = {
  /** Initiative's API base as the app reaches it. Default: `INITIATIVE_BASE_URL`. */
  baseUrl?: string;
  /**
   * The app's key: a PEM, a PEM with literal `\n`, or base64 of the PEM, and
   * the `kid` it is registered under (default: its thumbprint). Default:
   * `INITIATIVE_APP_PRIVATE_KEY` and `INITIATIVE_APP_KEY_ID`, else a key
   * generated on first start and kept in `dataDir`.
   */
  key?: { privateKey: string; kid?: string };
  /** Where a generated key is kept. Default: `INITIATIVE_APP_DATA_DIR`, else `data`. */
  dataDir?: string;
  /** The built manifest. Default: `manifest.json` in the working directory. */
  manifest?: Manifest;
  /** Default: `process.env`. */
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch. */
  now?: () => number;
  log?: Logger;
} & ({} extends AppContext ? { context?: AppContext } : { context: AppContext });

export type AppHandler = (request: Request) => Promise<Response>;

const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message, error) => (error === undefined ? console.error(message) : console.error(message, error)),
};

class TooLarge extends Error {}

/** The app's server, as a web-standard handler. */
export function createApp(
  app: AnyApp,
  ...[options = {} as AppOptions]: {} extends AppContext ? [AppOptions?] : [AppOptions]
): AppHandler {
  const env = options.env ?? process.env;
  const baseUrl = options.baseUrl ?? env.INITIATIVE_BASE_URL;
  if (!baseUrl) throw new TypeError("Initiative's address is required: set INITIATIVE_BASE_URL");
  const log = options.log ?? consoleLogger;
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const context = (options.context ?? {}) as AppContext;
  const key = appKey(options, env);
  const manifest = builtManifest(app, options.manifest);
  const document = JSON.stringify(appDocument(manifest, { uid: app.uid, name: app.name }));
  const jwks = JSON.stringify(publicJwks(key));

  const initiative = new Initiative({ baseUrl, publicId: app.publicId, key, fetch: fetchImpl, now });
  const verify: VerifyOptions = { publicId: app.publicId, baseUrl, jwks: new JwksCache({ fetchImpl, now }), now };
  const endpoints = new Map<string, EndpointDeclaration>(
    Object.entries(app.endpoints ?? {}).map(([name, endpoint]) => [endpointId(app, name), endpoint])
  );
  const surfaces = Object.entries(app.surfaces ?? {}).filter(([, surface]) => surface.handler);
  const spent = new Map<string, number>();

  const base = (installation: string, narrowing: { initiative?: number } = {}): Call => ({
    installation,
    client: initiative.asInstallation(installation, narrowing),
    context,
  });

  async function invoke(request: Request): Promise<Response> {
    const claims = await verified(request, (token) => verifyContextToken(token, verify));
    if (claims instanceof Response) return claims;
    const raw = await jsonBody(request);
    if (!isRecord(raw)) return refuse(400, "invalid-request", "expected a json object");
    if (typeof raw.endpoint !== "string" || !raw.endpoint) return refuse(400, "invalid-request", "endpoint is required");
    const id = raw.endpoint;
    const endpoint = endpoints.get(id);
    if (!endpoint) return refuse(400, "invalid-request", `this app does not offer '${id}'`);
    if (endpoint.direction === "emit") {
      return refuse(400, "invalid-request", `'${id}' is emitted rather than called — subscribe to it instead`);
    }
    if (claims.scope !== "endpoint") return refuse(400, "invalid-request", "this token is not for calling an endpoint");
    if (claims.endpoint_id !== id) {
      return refuse(400, "invalid-request", `this token is for '${claims.endpoint_id}', not '${id}'`);
    }
    const params = raw.params ?? {};
    if (!isRecord(params)) return refuse(400, "invalid-request", "params must be an object");

    if (claims.act) {
      if (!endpoint.public) return refuse(403, "endpoint-not-public");
      if (!claims.actor || !endpoint.actors?.includes(claims.actor)) return refuse(403, "actor-not-supported");
    } else if (endpoint.direction === "write") {
      return refuse(403, "actor-not-supported", "a write is called by another app, as one of its actors");
    }

    const initiativeId = claims.initiative_id;
    const narrowing = initiativeId === undefined ? {} : { initiative: initiativeId };
    const member = claims.actor === "member" ? claims.member : undefined;
    const outcome = await answered(
      () =>
        endpoint.handler({
          endpoint: id,
          params: params as Record<string, ParamValue>,
          installation: claims.guild_ref,
          actor: member === undefined ? { kind: "installation" } : { kind: "member", member },
          caller: claims.act?.sub ?? null,
          initiative: initiativeId ?? null,
          connections: claims.connection_refs ?? {},
          client:
            member === undefined
              ? initiative.asInstallation(claims.guild_ref, narrowing)
              : initiative.asMember(claims.guild_ref, member, narrowing),
          context,
        }),
      id
    );
    if (outcome instanceof Response) return outcome;
    return json(200, { endpoint: id, actor: outcome.actor ?? (member === undefined ? "installation" : "member"), result: outcome.result });
  }

  async function hook(request: Request, name: string): Promise<Response> {
    const known =
      name === "schedule"
        ? Object.keys(app.schedules ?? {}).length > 0
        : (name === "after_connect" || name === "revoke" || name === "webhook") && app.hooks?.[name] !== undefined;
    if (!known) return refuse(404, "not-found", "no such hook");
    const claims = await verified(request, (token) => verifyLifecycleToken(token, { ...verify, hook: name }));
    if (claims instanceof Response) return claims;
    const raw = await jsonBody(request);
    if (!isRecord(raw)) return refuse(400, "invalid-request", "expected a json object");
    const subject = name === "schedule" ? "schedule" : "connection";
    if (typeof raw[subject] !== "string" || !raw[subject]) return refuse(400, "invalid-request", `${subject} is required`);
    const call = base(claims.guild_ref);
    const hooks = app.hooks ?? {};

    if (name === "schedule") {
      const schedule = app.schedules?.[raw.schedule as string];
      if (!schedule) return refuse(404, "not-found", `no schedule '${raw.schedule}'`);
      const done = await answered(
        () => schedule.run({ ...call, schedule: raw.schedule as string, since: optionalString(raw.since) }),
        `schedule ${raw.schedule}`
      );
      return done instanceof Response ? done : empty(204);
    }
    if (name === "after_connect") {
      const parsed = afterConnectCall(raw);
      if (!parsed) return refuse(400, "invalid-request", "not an after_connect call");
      const answer = await answered(() => hooks.after_connect!({ ...call, ...parsed }), `after_connect for ${parsed.connection}`);
      return answer instanceof Response ? answer : json(200, answer);
    }
    if (name === "webhook") {
      const parsed = webhookCall(raw);
      if (!parsed) return refuse(400, "invalid-request", "not a webhook call");
      const done = await answered(() => hooks.webhook!({ ...call, ...parsed }), `webhook for ${parsed.connection}`);
      return done instanceof Response ? done : empty(204);
    }
    const done = await answered(
      () =>
        hooks.revoke!({
          ...call,
          connection: raw.connection as string,
          access_token: optionalString(raw.access_token),
          refresh_token: optionalString(raw.refresh_token),
        }),
      `revoke for ${raw.connection}`
    );
    return done instanceof Response ? done : empty(204);
  }

  async function surface(request: Request, id: string, declaration: SurfaceDeclaration): Promise<Response> {
    let handoff: Handoff | null = null;
    if (request.headers.has("authorization")) {
      const claims = await verified(request, (token) => verifyHandoffToken(token, verify));
      if (claims instanceof Response) return claims;
      if (claims.surface_id !== id) return refuse(401, "unauthorized", `this token is for '${claims.surface_id}', not '${id}'`);
      const seconds = Math.floor(now() / 1000);
      for (const [jti, exp] of spent) if (exp < seconds) spent.delete(jti);
      if (spent.has(claims.jti)) return refuse(401, "unauthorized", "this handoff token was already used");
      spent.set(claims.jti, claims.exp);
      handoff = {
        ...base(claims.guild_ref, claims.initiative_id === undefined ? {} : { initiative: claims.initiative_id }),
        surface: id,
        viewer: claims.sub,
        admin: claims.guild_admin === true,
        initiative: claims.initiative_id ?? null,
      };
    }
    return declaration.handler!({ request, handoff });
  }

  /** The token's claims, or the 401 to answer with. */
  async function verified<T>(request: Request, check: (token: string) => Promise<T>): Promise<T | Response> {
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) return refuse(401, "unauthorized", "a bearer token is required");
    try {
      return await check(token);
    } catch (error) {
      if (error instanceof ContextTokenError) return refuse(401, "unauthorized", error.message);
      throw error;
    }
  }

  /** What a handler answered, or the refusal it threw. Anything else is logged and answered 500. */
  async function answered<T>(run: () => Promise<T>, what: string): Promise<T | Response> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof EndpointError) {
        return json(error.status, error.detail === undefined ? { error: error.code } : { error: error.code, detail: error.detail });
      }
      log.error(`${what} failed`, error);
      return refuse(500, "internal");
    }
  }

  async function route(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const method = request.method;
    if (method === "GET" && (path === "/healthz" || path === "/readyz")) return json(200, { ok: true });
    if (method === "GET" && path === JWKS_ROUTE) return text(200, jwks);
    if (method === "GET" && path === MANIFEST_PATH) return text(200, document);
    if (path === ENDPOINTS_PATH && method === "GET") return json(200, { endpoints: manifest.endpoints ?? [] });
    if (path === ENDPOINTS_PATH && method === "POST") return invoke(request);
    if (method === "POST" && path.startsWith(HOOKS_PATH)) return hook(request, path.slice(HOOKS_PATH.length));
    for (const [id, declaration] of surfaces) {
      if (path === declaration.path || path.startsWith(`${declaration.path}/`)) return surface(request, id, declaration);
    }
    return refuse(404, "not-found");
  }

  return async (request) => {
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof TooLarge) return refuse(413, "too-large");
      log.error(`${request.method} ${new URL(request.url).pathname} failed`, error);
      return refuse(500, "internal");
    }
  };
}

/**
 * The app's handler on `node:http`, listening on `port` (default: `PORT`, else
 * 8080). Close the returned server to stop.
 */
export function serve(handler: AppHandler, options: { port?: number; hostname?: string } = {}): Server {
  const server = createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
        method,
        headers: headersOf(req.headers),
        ...(method === "GET" || method === "HEAD" ? {} : { body: Readable.toWeb(req) as ReadableStream, duplex: "half" }),
      } as RequestInit);
      const response = await handler(request);
      const cookies = response.headers.getSetCookie();
      for (const [name, value] of response.headers) if (name !== "set-cookie") res.setHeader(name, value);
      if (cookies.length) res.setHeader("set-cookie", cookies);
      res.writeHead(response.status);
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.listen(options.port ?? (Number(process.env.PORT) || 8080), options.hostname);
  return server;
}

function headersOf(incoming: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, one);
  }
  return headers;
}

/** The app's key: given, from the environment, or generated once and kept. */
function appKey(options: AppOptions, env: Record<string, string | undefined>): AppSigningKey {
  const given = options.key?.privateKey ?? env.INITIATIVE_APP_PRIVATE_KEY;
  if (given) return loadPrivateKey(pemText(given), options.key?.kid ?? env.INITIATIVE_APP_KEY_ID);
  const dir = options.dataDir ?? env.INITIATIVE_APP_DATA_DIR ?? "data";
  const path = join(dir, "app-key.pem");
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, generateAppKeys({ alg: "ES256" }).privateKeyPem, { mode: 0o600, flag: "wx" });
  }
  return loadPrivateKey(readFileSync(path, "utf-8"));
}

/** A PEM as written, with `\n` typed literally, or base64 of the PEM. */
function pemText(raw: string): string {
  return raw.includes("-----BEGIN") ? raw.replaceAll("\\n", "\n") : Buffer.from(raw, "base64").toString("utf-8");
}

/**
 * The manifest the app serves: what `initiative-app build` wrote, held to the
 * definition so a stale build is refused at start.
 */
function builtManifest(app: AnyApp, given: Manifest | undefined): Manifest {
  const path = "manifest.json";
  const built: Manifest | undefined = given ?? (existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : undefined);
  if (!built) {
    if (Object.keys(app.widgets ?? {}).length) throw new Error("no manifest.json: run initiative-app build");
    return manifestOf(app);
  }
  const modules = Object.fromEntries((built.widgets ?? []).map((widget) => [widget.id, widget.module_source]));
  if (JSON.stringify(manifestOf(app, modules)) !== JSON.stringify(built)) {
    throw new Error("manifest.json does not match the app's definition: run initiative-app build");
  }
  return built;
}

async function jsonBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new TooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    for await (const chunk of request.body) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new TooLarge();
      chunks.push(chunk);
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return undefined;
  }
}

function afterConnectCall(
  raw: Record<string, unknown>
): { connection: string; actor: ActorKind; access_token: string; params: Record<string, string> } | null {
  if (raw.actor !== "installation" && raw.actor !== "member") return null;
  if (typeof raw.access_token !== "string" || !raw.access_token) return null;
  if (raw.params !== undefined && raw.params !== null && !isRecord(raw.params)) return null;
  const params = Object.fromEntries(
    Object.entries((raw.params ?? {}) as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
  return { connection: raw.connection as string, actor: raw.actor, access_token: raw.access_token, params };
}

function webhookCall(raw: Record<string, unknown>) {
  if (typeof raw.body !== "string" || !isRecord(raw.headers)) return null;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.headers)) {
    if (typeof value === "string") headers[key.toLowerCase()] = value;
  }
  return { connection: raw.connection as string, headers, body: raw.body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function json(status: number, body: unknown): Response {
  return text(status, JSON.stringify(body));
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function empty(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

function refuse(status: number, code: string, detail?: string): Response {
  return json(status, detail === undefined ? { error: code } : { error: code, detail });
}
