/**
 * The server: every route Initiative calls, answered from the definition, with
 * Initiative's tokens signed here by a test key standing in for the
 * deployment's.
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { manifestOf } from "../src/define.js";
import { generateAppKeys, loadPrivateKey, signJwt } from "../src/keys.js";
import { createApp, serve, type AppHandler } from "../src/server.js";
import { CONTEXT_TOKEN_TYPE, HANDOFF_TOKEN_TYPE } from "../src/tokens.js";
import { trackerApp } from "./support/app.js";

const BASE = "https://initiative.example.com/api/v1";
const platform = generateAppKeys({ alg: "RS256", kid: "platform-1" });
const stranger = generateAppKeys({ alg: "RS256", kid: "platform-1" });
const appKeys = generateAppKeys({ alg: "ES256", kid: "app-1" });
const MODULES = { "open-count": "globalThis.render = function () {};" };

function sign(
  claims: Record<string, unknown>,
  pem = platform.privateKeyPem,
  typ = CONTEXT_TOKEN_TYPE
): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(loadPrivateKey(pem, "platform-1"), {
    jti: randomUUID(),
    iss: "initiative",
    aud: "initiative-app:acme.tracker",
    iat: now,
    exp: now + 60,
    guild_ref: "gapp_1",
    app_install_id: 1,
    ...claims,
  }, typ);
}

const contextToken = (endpoint: string, claims: Record<string, unknown> = {}) =>
  sign({ scope: "endpoint", endpoint_id: `app.acme.tracker.${endpoint}`, ...claims });
const hookToken = (hook: string, claims: Record<string, unknown> = {}) => sign({ scope: "lifecycle", hook, ...claims });
const handoffToken = (claims: Record<string, unknown> = {}) =>
  sign({ sub: "uapp_alice", surface_id: "board", initiative_id: 4, guild_admin: true, ...claims }, undefined, HANDOFF_TOKEN_TYPE);

const outbound = (async (input: string | URL | Request) => {
  if (String(input) === "https://initiative.example.com/api/v1/app-platform/jwks.json") return Response.json(platform.jwks);
  throw new Error(`unexpected call to ${input}`);
}) as typeof fetch;

let handler: AppHandler;
let seen: ReturnType<typeof trackerApp>["seen"];
let logs: string[];

function start(options: Record<string, unknown> = {}): AppHandler {
  const tracker = trackerApp();
  seen = tracker.seen;
  logs = [];
  return createApp(tracker.app, {
    baseUrl: BASE,
    key: { privateKey: appKeys.privateKeyPem, kid: "app-1" },
    manifest: manifestOf(tracker.app, MODULES),
    fetch: outbound,
    log: { info: () => {}, warn: () => {}, error: (message) => logs.push(message) },
    env: {},
    ...options,
  });
}

beforeEach(() => {
  handler = start();
});

const get = (path: string, headers: Record<string, string> = {}) =>
  handler(new Request(`http://app.test${path}`, { headers }));

const read = async (response: Response | Promise<Response>): Promise<any> => (await response).json();

async function post(path: string, body: unknown, token?: string) {
  const response = await handler(
    new Request(`http://app.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const invoke = (endpoint: string, params: Record<string, unknown>, token = contextToken(endpoint)) =>
  post("/v1/endpoints", { endpoint: `app.acme.tracker.${endpoint}`, params }, token);

const asMember = { act: { sub: "acme.github" }, actor: "member", member: "uref_alice", initiative_id: 5 };

describe("what the app publishes", () => {
  it("answers health checks", async () => {
    expect((await get("/healthz")).status).toBe(200);
    expect((await get("/readyz")).status).toBe(200);
  });

  it("serves its public key, and nothing private", async () => {
    const jwks = await read(get("/.well-known/jwks.json"));
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kid: "app-1", kty: "EC", alg: "ES256" });
    expect(jwks.keys[0]).not.toHaveProperty("d");
  });

  it("serves its manifest document at the well-known path", async () => {
    const tracker = trackerApp();
    expect(await read(get("/.well-known/initiative-app.json"))).toEqual({
      protocol_version: 1,
      public_id: "acme.tracker",
      kind: "app",
      uid: "K7M2QX8N4TVB9C",
      name: "Tracker",
      definition: manifestOf(tracker.app, MODULES),
    });
  });

  it("lists what it declares", async () => {
    const body = await read(get("/v1/endpoints"));
    expect(body.endpoints.map((endpoint: { id: string }) => endpoint.id)).toEqual([
      "app.acme.tracker.projects",
      "app.acme.tracker.open-tickets",
      "app.acme.tracker.close-ticket",
      "app.acme.tracker.ticket-opened",
    ]);
  });
});

describe("endpoint calls", () => {
  it("hands Initiative's own call to the handler as the community's", async () => {
    const { status, body } = await invoke("open-tickets", { project: "p1", labels: ["bug"] }, contextToken("open-tickets", {
      connection_refs: { account: "cref_alice" },
    }));
    expect(status).toBe(200);
    expect(body).toEqual({
      endpoint: "app.acme.tracker.open-tickets",
      actor: "installation",
      result: { titles: ["Broken build"], total: 1 },
    });
    const [{ call }] = seen;
    expect(call).toMatchObject({
      endpoint: "app.acme.tracker.open-tickets",
      params: { project: "p1", labels: ["bug"] },
      installation: "gapp_1",
      actor: { kind: "installation" },
      caller: null,
      initiative: null,
      connections: { account: "cref_alice" },
    });
    expect(call.client.installation).toBe("gapp_1");
    expect(call.client.actor).toEqual({ kind: "installation" });
  });

  it("hands another app's call to the handler as the member it is for, confined to its initiative", async () => {
    const { body } = await invoke("close-ticket", {}, contextToken("close-ticket", asMember));
    expect(body).toEqual({ endpoint: "app.acme.tracker.close-ticket", actor: "member", result: { closed: true } });
    const [{ call }] = seen;
    expect(call).toMatchObject({ actor: { kind: "member", member: "uref_alice" }, caller: "acme.github", initiative: 5 });
    expect(call.client.actor).toEqual({ kind: "member", member: "uref_alice" });
    expect(call.client.initiative).toBe(5);
  });

  it("reports the actor the handler says ran the call", async () => {
    const { body } = await invoke("open-tickets", { project: "mine" });
    expect(body.actor).toBe("member");
  });

  it("answers a handler's refusal with its status and code", async () => {
    const { status, body } = await invoke("open-tickets", { project: "refuse" });
    expect(status).toBe(409);
    expect(body).toEqual({ error: "not-configured", detail: "no project yet" });
  });

  it("answers a handler that fails with 500, and logs it", async () => {
    const { status, body } = await invoke("open-tickets", { project: "fail" });
    expect(status).toBe(500);
    expect(body).toEqual({ error: "internal" });
    expect(logs).toEqual(["app.acme.tracker.open-tickets failed"]);
  });

  const refusals: Array<[string, () => Promise<{ status: number; body: Record<string, string> }>, number, string]> = [
    ["no token", () => invoke("open-tickets", {}, ""), 401, "unauthorized"],
    ["a key the deployment never published", () => invoke("open-tickets", {}, sign({ scope: "endpoint", endpoint_id: "app.acme.tracker.open-tickets" }, stranger.privateKeyPem)), 401, "unauthorized"],
    ["a token for another app", () => invoke("open-tickets", {}, contextToken("open-tickets", { aud: "initiative-app:acme.other" })), 401, "unauthorized"],
    ["a token for another endpoint", () => invoke("open-tickets", {}, contextToken("projects")), 400, "this token is for 'app.acme.tracker.projects'"],
    ["a lifecycle token", () => invoke("open-tickets", {}, hookToken("webhook")), 400, "this token is not for calling an endpoint"],
    ["an endpoint the app does not declare", () => invoke("delete-everything", {}), 400, "does not offer"],
    ["an announcement", () => invoke("ticket-opened", {}), 400, "emitted rather than called"],
    ["parameters that are not an object", () => invoke("open-tickets", ["p1"] as never), 400, "params must be an object"],
    ["a body that is not JSON", () => post("/v1/endpoints", "{", contextToken("open-tickets")), 400, "expected a json object"],
    ["another app, on an endpoint that is not public", () => invoke("projects", {}, contextToken("projects", asMember)), 403, "endpoint-not-public"],
    ["another app, as an actor the endpoint does not take", () => invoke("close-ticket", {}, contextToken("close-ticket", { act: { sub: "acme.github" }, actor: "installation" })), 403, "actor-not-supported"],
    ["a write that no app asked for", () => invoke("close-ticket", {}), 403, "actor-not-supported"],
  ];

  for (const [what, call, status, says] of refusals) {
    it(`refuses ${what}`, async () => {
      const answer = await call();
      expect(answer.status).toBe(status);
      expect(`${answer.body.error} ${answer.body.detail ?? ""}`).toContain(says);
      expect(seen).toHaveLength(0);
    });
  }

  it("refuses a body over the cap", async () => {
    const { status, body } = await post("/v1/endpoints", { endpoint: "x", filler: "x".repeat(6 * 1024 * 1024) }, contextToken("x"));
    expect(status).toBe(413);
    expect(body).toEqual({ error: "too-large" });
  });
});

describe("hooks", () => {
  const connected = { connection: "account", actor: "member", access_token: "vendor-token", params: { state: "x", n: 1 } };

  it("answers after_connect with the handler's answer, or its refusal", async () => {
    expect(await post("/v1/hooks/after_connect", connected, hookToken("after_connect"))).toEqual({
      status: 200,
      body: { account_label: "@alice" },
    });
    expect(seen[0].call).toMatchObject({ connection: "account", actor: "member", access_token: "vendor-token", params: { state: "x" }, installation: "gapp_1" });
    const refused = await post("/v1/hooks/after_connect", { ...connected, access_token: "stranger" }, hookToken("after_connect"));
    expect(refused.body).toEqual({ refuse: true });
  });

  it("answers a failed hook with 500, and logs which", async () => {
    const { status } = await post("/v1/hooks/after_connect", { ...connected, access_token: "fail" }, hookToken("after_connect"));
    expect(status).toBe(500);
    expect(logs).toEqual(["after_connect for account failed"]);
  });

  it("runs a schedule by its id, with when it last succeeded", async () => {
    const { status } = await post("/v1/hooks/schedule", { schedule: "sweep", since: "2026-09-01T00:00:00Z" }, hookToken("schedule"));
    expect(status).toBe(204);
    expect(seen[0]).toMatchObject({ name: "sweep", call: { schedule: "sweep", since: "2026-09-01T00:00:00Z" } });
    const unknown = await post("/v1/hooks/schedule", { schedule: "other", since: null }, hookToken("schedule"));
    expect(unknown.status).toBe(404);
  });

  it("hands on a vendor delivery with its headers lowercased, and a revocation", async () => {
    const delivery = { connection: "workspace", headers: { "X-Vendor-Event": "opened" }, body: '{"a":1}' };
    expect((await post("/v1/hooks/webhook", delivery, hookToken("webhook"))).status).toBe(204);
    expect(seen[0].call).toMatchObject({ headers: { "x-vendor-event": "opened" }, body: '{"a":1}' });
    const revoked = await post("/v1/hooks/revoke", { connection: "account", access_token: "t" }, hookToken("revoke"));
    expect(revoked.status).toBe(204);
    expect(seen[1].call).toMatchObject({ access_token: "t", refresh_token: null });
  });

  it("refuses a token minted for another hook, an endpoint token, and none", async () => {
    for (const token of [hookToken("revoke"), contextToken("projects"), ""]) {
      expect((await post("/v1/hooks/after_connect", connected, token)).status).toBe(401);
    }
    expect(seen).toHaveLength(0);
  });

  it("answers 404 for a hook the app does not have, and 400 for a body that is not the hook's", async () => {
    expect((await post("/v1/hooks/before_connect", connected, hookToken("before_connect"))).status).toBe(404);
    const bad = await post("/v1/hooks/after_connect", { connection: "account", actor: "nobody" }, hookToken("after_connect"));
    expect(bad).toEqual({ status: 400, body: { error: "invalid-request", detail: "not an after_connect call" } });
  });
});

describe("surfaces", () => {
  it("serves the page's own requests with no handoff", async () => {
    expect(await read(get("/board"))).toEqual({ viewer: null, initiative: null, admin: null });
  });

  it("hands a verified handoff to the page, once", async () => {
    const token = handoffToken();
    const opened = await get("/board/session", { Authorization: `Bearer ${token}` });
    expect(await read(opened)).toEqual({ viewer: "uapp_alice", initiative: 4, admin: true });
    expect((await get("/board/session", { Authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("refuses a handoff for another surface, or one not signed by the deployment", async () => {
    expect((await get("/board", { Authorization: `Bearer ${handoffToken({ surface_id: "settings" })}` })).status).toBe(401);
    const foreign = sign({ sub: "uapp_alice", surface_id: "board" }, stranger.privateKeyPem);
    expect((await get("/board", { Authorization: `Bearer ${foreign}` })).status).toBe(401);
  });
});

describe("starting", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "initiative-app-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("generates a key on first start, keeps it, and uses it again", async () => {
    const first = start({ key: undefined, dataDir: dir });
    const kid = (await read(first(new Request("http://app.test/.well-known/jwks.json")))).keys[0].kid;
    expect(statSync(join(dir, "app-key.pem")).mode & 0o777).toBe(0o600);
    const again = start({ key: undefined, env: { INITIATIVE_APP_DATA_DIR: dir } });
    expect((await read(again(new Request("http://app.test/.well-known/jwks.json")))).keys[0].kid).toBe(kid);
  });

  it("reads Initiative's address and the key from the environment", async () => {
    const fromEnv = start({
      baseUrl: undefined,
      key: undefined,
      env: {
        INITIATIVE_BASE_URL: BASE,
        INITIATIVE_APP_PRIVATE_KEY: Buffer.from(appKeys.privateKeyPem).toString("base64"),
        INITIATIVE_APP_KEY_ID: "env-1",
      },
    });
    expect((await read(fromEnv(new Request("http://app.test/.well-known/jwks.json")))).keys[0].kid).toBe("env-1");
    expect(() => start({ baseUrl: undefined })).toThrow(/INITIATIVE_BASE_URL/);
  });

  it("refuses a built manifest the definition no longer matches", () => {
    const stale = manifestOf(trackerApp().app, MODULES);
    stale.endpoints = stale.endpoints!.slice(1);
    expect(() => start({ manifest: stale })).toThrow(/run initiative-app build/);
  });

  it("serves on node:http", async () => {
    const server = serve(handler, { port: 0, hostname: "127.0.0.1" });
    await new Promise((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${url}/healthz`)).status).toBe(200);
      const response = await fetch(`${url}/v1/endpoints`, {
        method: "POST",
        headers: { Authorization: `Bearer ${contextToken("projects")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "app.acme.tracker.projects", params: {} }),
      });
      expect(await read(response)).toMatchObject({ result: { ids: ["p1", "p2"] } });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
