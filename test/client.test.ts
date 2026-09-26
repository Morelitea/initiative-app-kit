/**
 * The client: the tokens it asks for, how it caches and narrows them, and the
 * calls it makes with them, against a stand-in for Initiative's API.
 */

import { createPublicKey, verify } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ConsentRequiredError,
  generateAppKeys,
  Initiative,
  InitiativeApiError,
  InitiativeAuthError,
  loadPrivateKey,
  MissingScopeError,
} from "../src/client.js";

const BASE = "https://initiative.example.com/api/v1";
const TOKEN_URL = `${BASE}/app-platform/oauth/token`;
const keys = generateAppKeys({ alg: "ES256", kid: "app-1" });
const NOW = 1_780_000_000_000;

interface Sent {
  url: string;
  method: string;
  authorization: string | null;
  body: string;
}

let sent: Sent[];
let issued: number;
let scope: string;
let answers: Map<string, (request: Sent) => Response>;
let clock: number;

beforeEach(() => {
  sent = [];
  issued = 0;
  scope = "projects:write apps:acme.github";
  answers = new Map();
  clock = NOW;
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const request: Sent = {
    url: String(input),
    method: init.method ?? "GET",
    authorization: new Headers(init.headers).get("authorization"),
    body: String(init.body ?? ""),
  };
  sent.push(request);
  if (request.url === TOKEN_URL) {
    const form = new URLSearchParams(request.body);
    if (form.get("assertion") && decode(form.get("assertion")!).sub === "uapp_nobody") {
      return json(400, { error: "consent_required", error_description: "no live consent" });
    }
    issued += 1;
    return json(200, { access_token: `token-${issued}`, token_type: "Bearer", expires_in: 600, scope });
  }
  const answer = answers.get(`${request.method} ${new URL(request.url).pathname}`);
  return answer ? answer(request) : json(404, { detail: "not_found" });
}) as typeof fetch;

function decode(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf-8"));
}

const initiative = () =>
  new Initiative({
    baseUrl: `${BASE}/`,
    publicId: "acme.tracker",
    key: loadPrivateKey(keys.privateKeyPem, keys.kid),
    fetch: fetchImpl,
    now: () => clock,
  });

const tokenForms = () => sent.filter((one) => one.url === TOKEN_URL).map((one) => new URLSearchParams(one.body));

describe("tokens", () => {
  it("asks for an installation token with an assertion the app's key signed, addressed to the token endpoint", async () => {
    answers.set("GET /api/v1/app-platform/installation/config", () => json(200, { guild_ref: "gapp_1" }));
    await initiative().asInstallation("gapp_1").config();

    const [form] = tokenForms();
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("installation")).toBe("gapp_1");
    const assertion = form.get("client_assertion")!;
    expect(decode(assertion)).toMatchObject({ iss: "acme.tracker", sub: "acme.tracker", aud: TOKEN_URL });
    const [header, payload, signature] = assertion.split(".");
    const key = createPublicKey({ key: keys.jwks.keys[0] as never, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("reuses a token until shortly before it expires, and shares one request between concurrent callers", async () => {
    answers.set("POST /api/v1/app-platform/installation/events", () => json(202, {}));
    const client = initiative().asInstallation("gapp_1");
    await Promise.all([client.emitEvent({ eventType: "app.acme.tracker.x" }), client.emitEvent({ eventType: "app.acme.tracker.x" })]);
    expect(issued).toBe(1);
    clock += 571_000;
    await client.emitEvent({ eventType: "app.acme.tracker.x" });
    expect(issued).toBe(2);
  });

  it("narrows a token to one initiative and fewer scopes", async () => {
    answers.set("GET /api/v1/c/0/projects/", () => json(200, []));
    await initiative().asInstallation("gapp_1", { initiative: 42, scopes: ["projects:read"] }).request("GET", "/projects/", { scope: "projects:read" });
    const [form] = tokenForms();
    expect(form.get("resource")).toBe("urn:initiative:initiative:42");
    expect(form.get("scope")).toBe("projects:read");
  });

  it("acts for a member on the JWT-bearer grant, and says when they have not consented", async () => {
    answers.set("GET /api/v1/c/0/projects/", () => json(200, []));
    await initiative().asMember("gapp_1", "uapp_alice", { purpose: "node-7" }).request("GET", "/projects/", { scope: "projects:read" });
    const [form] = tokenForms();
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(decode(form.get("assertion")!)).toMatchObject({ sub: "uapp_alice", installation: "gapp_1", purpose: "node-7" });

    const refused = initiative().asMember("gapp_1", "uapp_nobody").request("GET", "/projects/", { scope: "projects:read" });
    await expect(refused).rejects.toBeInstanceOf(ConsentRequiredError);
  });

  it("raises the token endpoint's own error", async () => {
    const failing = (async () => json(401, { error: "invalid_client" })) as unknown as typeof fetch;
    const client = new Initiative({ baseUrl: BASE, publicId: "acme.tracker", key: loadPrivateKey(keys.privateKeyPem), fetch: failing });
    const error = await client.asInstallation("gapp_1").config().catch((caught) => caught);
    expect(error).toBeInstanceOf(InitiativeAuthError);
    expect(error).toMatchObject({ error: "invalid_client", status: 401 });
  });
});

describe("calls", () => {
  it("addresses a community route under /c/0 and answers its JSON", async () => {
    answers.set("POST /api/v1/c/0/projects/7/comments", (request) => json(201, { echoed: JSON.parse(request.body) }));
    const answer = await initiative().asInstallation("gapp_1").request("POST", "/projects/7/comments", {
      scope: "projects:write",
      body: { text: "hi" },
    });
    expect(answer).toEqual({ echoed: { text: "hi" } });
  });

  it("sends nothing a token's scopes do not cover, and names the scope; writing implies reading", async () => {
    answers.set("GET /api/v1/c/0/projects/", () => json(200, []));
    const client = initiative().asInstallation("gapp_1");
    await expect(client.request("GET", "/projects/", { scope: "projects:read" })).resolves.toEqual([]);
    const error = (await client.request("GET", "/documents/", { scope: "documents:read" }).catch((caught) => caught)) as MissingScopeError;
    expect(error).toBeInstanceOf(MissingScopeError);
    expect(error.scope).toBe("documents:read");
    expect(sent.filter((one) => one.url.includes("/documents/"))).toHaveLength(0);
  });

  it("sends a call answered 401 once more, on a fresh token", async () => {
    let calls = 0;
    answers.set("GET /api/v1/c/0/projects/", () => (++calls === 1 ? json(401, { detail: "expired" }) : json(200, [])));
    await initiative().asInstallation("gapp_1").request("GET", "/projects/", { scope: "projects:read" });
    const projects = sent.filter((one) => one.url.endsWith("/projects/"));
    expect(projects.map((one) => one.authorization)).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  it("raises Initiative's detail on a refusal", async () => {
    answers.set("POST /api/v1/app-platform/installation/connections/cref_1/token", () => json(409, { detail: "APP_CHANNEL_CONNECTION_EXPIRED" }));
    const error = await initiative().asInstallation("gapp_1").connectionToken("cref_1").catch((caught) => caught);
    expect(error).toBeInstanceOf(InitiativeApiError);
    expect(error).toMatchObject({ status: 409, detail: "APP_CHANNEL_CONNECTION_EXPIRED" });
  });

  it("calls another app through Initiative, needing apps:<its public id>", async () => {
    answers.set("POST /api/v1/app-platform/apps/acme.github/endpoints/app.acme.github.open-issue", () =>
      json(200, { endpoint: "app.acme.github.open-issue", actor: "member", result: { number: 7 } })
    );
    const client = initiative().asMember("gapp_1", "uapp_alice");
    const outcome = await client.callApp("acme.github", "app.acme.github.open-issue", { title: "x" });
    expect(outcome.result).toEqual({ number: 7 });
    expect(JSON.parse(sent.at(-1)!.body)).toEqual({ params: { title: "x" } });
    await expect(client.callApp("acme.slack", "app.acme.slack.post")).rejects.toBeInstanceOf(MissingScopeError);
  });
});

describe("the installation itself", () => {
  it("reads its configuration, connections and connection tokens, reports status and emits events", async () => {
    answers.set("GET /api/v1/app-platform/installation/config", () =>
      json(200, {
        guild_ref: "gapp_1",
        install_id: 3,
        listing_uid: "K7M2QX8N4TVB9C",
        listing_version: "1.0.0",
        enabled: true,
        config_state: "ok",
        config_state_detail: null,
        needs_config: false,
        connections: { workspace: { owner: "acme" } },
        connection_refs: { workspace: "cref_ws" },
        member_connections: [{ connection_id: "account", connection_ref: "cref_a", status: "connected", values: {} }],
      })
    );
    answers.set("GET /api/v1/app-platform/installation/connections", () =>
      json(200, { items: [{ connection_id: "account", connection_ref: "cref_a", status: "connected", blocked: false, account_label: "@a" }] })
    );
    answers.set("POST /api/v1/app-platform/installation/connections/cref_ws/token", () =>
      json(200, { access_token: "vendor-token", expires_at: 1_780_000_600 })
    );
    answers.set("POST /api/v1/app-platform/installation/config-status", (request) =>
      json(200, { guild_ref: "gapp_1", install_id: 3, config_state: JSON.parse(request.body).state, config_state_detail: null })
    );
    answers.set("POST /api/v1/app-platform/installation/events", () => json(202, { status: "accepted" }));

    // A member's client reaches the installation on the installation's token.
    const client = initiative().asMember("gapp_1", "uapp_alice", { initiative: 5 });
    expect(await client.config()).toMatchObject({
      guildRef: "gapp_1",
      configState: "ok",
      connections: { workspace: { owner: "acme" } },
      connectionRefs: { workspace: "cref_ws" },
      memberConnections: [{ connectionId: "account", connectionRef: "cref_a", status: "connected" }],
    });
    expect(await client.connections()).toMatchObject([{ connectionRef: "cref_a", accountLabel: "@a" }]);
    expect(await client.connectionToken("cref_ws")).toEqual({ accessToken: "vendor-token", expiresAt: 1_780_000_600_000 });
    expect(await client.reportConfigStatus({ state: "invalid", detail: "missing_scope" })).toMatchObject({ configState: "invalid" });
    await client.emitEvent({ eventType: "app.acme.tracker.ticket-opened", payload: { number: 1 }, initiativeId: 5 });
    expect(JSON.parse(sent.at(-1)!.body)).toEqual({
      event_type: "app.acme.tracker.ticket-opened",
      payload: { number: 1 },
      initiative_id: 5,
    });

    const [form] = tokenForms();
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("resource")).toBe("urn:initiative:initiative:5");
    expect(tokenForms()).toHaveLength(1);
  });

  it("asks a member for consent on the installation's token", async () => {
    answers.set("POST /api/v1/app-platform/consent-requests", (request) => json(201, JSON.parse(request.body)));
    const answer = await initiative()
      .asInstallation("gapp_1")
      .requestConsent({ member: "uapp_alice", purpose: "node-7", label: "Comment as you", access: "read_write" });
    expect(answer).toEqual({ member: "uapp_alice", label: "Comment as you", access: "read_write", purpose: "node-7" });
  });

  it("lists every installation, following the pages to the end", async () => {
    answers.set("GET /api/v1/app-platform/installations", (request) =>
      new URL(request.url).searchParams.get("page") === "2"
        ? json(200, [{ installation: "gapp_2", active: false }])
        : json(200, [{ installation: "gapp_1", active: true }], { Link: '</api/v1/app-platform/installations?page=2>; rel="next"' })
    );
    expect(await initiative().installations()).toEqual([
      { installation: "gapp_1", active: true },
      { installation: "gapp_2", active: false },
    ]);
    const [form] = tokenForms();
    expect(form.get("installation")).toBeNull();
  });
});
