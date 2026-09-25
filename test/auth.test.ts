/**
 * Tokens from Initiative: the exact assertions and form bodies each grant
 * sends, caching, and how errors come back.
 */

import { createPublicKey, verify } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CLIENT_ASSERTION_TYPE,
  ConsentRequiredError,
  InitiativeApiError,
  InitiativeAuth,
  InitiativeAuthError,
  JWT_BEARER_GRANT,
  guildPath,
  initiativeResource,
} from "../src/auth.js";
import { generateAppKeys, type GeneratedAppKeys } from "../src/keys.js";

const BASE = "https://initiative.example.com/api/v1";
const TOKEN_URL = `${BASE}/app-platform/oauth/token`;
const CLIENT = "acme.tracker";
const NOW = 1_780_000_000_000;

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

const keys: Record<"RS256" | "ES256", GeneratedAppKeys> = {
  RS256: generateAppKeys({ alg: "RS256", kid: "rsa-1" }),
  ES256: generateAppKeys({ alg: "ES256", kid: "ec-1" }),
};

function decode(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf-8"));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenResponse(
  token = "iat_opaque",
  extra: Record<string, unknown> = {}
): Response {
  return json({ access_token: token, token_type: "Bearer", expires_in: 600, ...extra });
}

/** A fetch that records every call and answers from a queue or a function. */
function recorder(answer: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const doFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? init.body : "",
    };
    calls.push(call);
    return answer(call, calls.length - 1);
  }) as typeof fetch;
  return { calls, doFetch };
}

function form(call: Call): Array<[string, string]> {
  return [...new URLSearchParams(call.body).entries()];
}

describe("the token endpoint", () => {
  let now = NOW;
  beforeEach(() => {
    now = NOW;
  });

  const auth = (doFetch: typeof fetch, alg: "RS256" | "ES256" = "RS256") =>
    new InitiativeAuth({
      baseUrl: `${BASE}/`,
      clientId: CLIENT,
      privateKey: keys[alg].privateKeyPem,
      kid: keys[alg].kid,
      alg,
      fetch: doFetch,
      clock: () => now,
    });

  it("is the API base plus /app-platform/oauth/token", () => {
    const { doFetch } = recorder(() => tokenResponse());
    expect(auth(doFetch).tokenEndpoint).toBe(TOKEN_URL);
  });

  describe.each(["RS256", "ES256"] as const)("client assertion (%s)", (alg) => {
    it("has the exact header and claims, and verifies with the registered JWKS", async () => {
      const { calls, doFetch } = recorder(() => tokenResponse());
      await auth(doFetch, alg).appToken();

      const assertion = new URLSearchParams(calls[0].body).get("client_assertion")!;
      const [header, payload, signature] = assertion.split(".");
      expect(decode(header)).toEqual({ alg, kid: keys[alg].kid, typ: "JWT" });

      const claims = decode(payload);
      expect(Object.keys(claims).sort()).toEqual(["aud", "exp", "iat", "iss", "jti", "sub"]);
      expect(claims).toMatchObject({
        iss: CLIENT,
        sub: CLIENT,
        aud: TOKEN_URL,
        iat: NOW / 1000,
        exp: NOW / 1000 + 60,
      });
      expect(typeof claims.jti).toBe("string");

      const key = createPublicKey({ key: keys[alg].jwks.keys[0] as never, format: "jwk" });
      const input = Buffer.from(`${header}.${payload}`);
      const raw = Buffer.from(signature, "base64url");
      expect(
        alg === "ES256"
          ? verify("sha256", input, { key, dsaEncoding: "ieee-p1363" }, raw)
          : verify("sha256", input, key, raw)
      ).toBe(true);
    });
  });

  it("uses a fresh jti for every assertion", async () => {
    const { calls, doFetch } = recorder(() => tokenResponse());
    const client = auth(doFetch);
    await client.installationToken({ installation: "gapp_a" });
    await client.installationToken({ installation: "gapp_b" });
    const jtis = calls.map((call) => {
      const assertion = new URLSearchParams(call.body).get("client_assertion")!;
      return decode(assertion.split(".")[1]).jti;
    });
    expect(new Set(jtis).size).toBe(2);
  });

  it("app token: client_credentials with no installation", async () => {
    const { calls, doFetch } = recorder(() => tokenResponse("iat_app"));
    const token = await auth(doFetch).appToken();

    expect(calls[0].url).toBe(TOKEN_URL);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(form(calls[0]).map(([name]) => name)).toEqual([
      "grant_type",
      "client_assertion_type",
      "client_assertion",
    ]);
    expect(new URLSearchParams(calls[0].body).get("grant_type")).toBe("client_credentials");
    expect(new URLSearchParams(calls[0].body).get("client_assertion_type")).toBe(
      CLIENT_ASSERTION_TYPE
    );
    expect(token).toEqual({ token: "iat_app", scopes: [], expiresAt: NOW + 600_000 });
  });

  it("installation token: the installation, and nothing else by default", async () => {
    const { calls, doFetch } = recorder(() =>
      tokenResponse("iat_inst", { scope: "projects:read projects:write" })
    );
    const token = await auth(doFetch).installationToken({ installation: "gapp_abc" });

    const body = form(calls[0]);
    expect(body.map(([name]) => name)).toEqual([
      "grant_type",
      "client_assertion_type",
      "client_assertion",
      "installation",
    ]);
    expect(body[0]).toEqual(["grant_type", "client_credentials"]);
    expect(body[3]).toEqual(["installation", "gapp_abc"]);
    expect(token.scopes).toEqual(["projects:read", "projects:write"]);
  });

  it("installation token: scope is space-separated, resource names the initiative", async () => {
    const { calls, doFetch } = recorder(() => tokenResponse());
    await auth(doFetch).installationToken({
      installation: "gapp_abc",
      scopes: ["projects:write", "comments:read", "projects:write"],
      initiativeId: 42,
    });

    const body = form(calls[0]);
    expect(body.slice(3)).toEqual([
      ["installation", "gapp_abc"],
      ["scope", "comments:read projects:write"],
      ["resource", "urn:initiative:initiative:42"],
    ]);
    // Form-encoded, so the space travels as '+'.
    expect(calls[0].body).toContain("scope=comments%3Aread+projects%3Awrite");
  });

  it("installation token: without a scope in the response, reports what was asked", async () => {
    const { doFetch } = recorder(() => tokenResponse());
    const token = await auth(doFetch).installationToken({
      installation: "gapp_abc",
      scopes: ["tags:read"],
    });
    expect(token.scopes).toEqual(["tags:read"]);
  });

  it("member token: jwt-bearer with one assertion and no client assertion", async () => {
    const { calls, doFetch } = recorder(() => tokenResponse("iat_member"));
    await auth(doFetch).memberToken({
      installation: "gapp_abc",
      member: "uapp_alice",
      purpose: "node-7",
      scopes: ["comments:write"],
      initiativeId: 3,
    });

    const body = form(calls[0]);
    expect(body.map(([name]) => name)).toEqual(["grant_type", "assertion", "scope", "resource"]);
    expect(body[0]).toEqual(["grant_type", JWT_BEARER_GRANT]);
    expect(body[2]).toEqual(["scope", "comments:write"]);
    expect(body[3]).toEqual(["resource", "urn:initiative:initiative:3"]);

    const [header, payload] = body[1][1].split(".");
    expect(decode(header)).toEqual({ alg: "RS256", kid: "rsa-1", typ: "JWT" });
    const claims = decode(payload);
    expect(Object.keys(claims).sort()).toEqual([
      "aud",
      "exp",
      "iat",
      "installation",
      "iss",
      "jti",
      "purpose",
      "sub",
    ]);
    expect(claims).toMatchObject({
      iss: CLIENT,
      sub: "uapp_alice",
      aud: TOKEN_URL,
      iat: NOW / 1000,
      exp: NOW / 1000 + 60,
      installation: "gapp_abc",
      purpose: "node-7",
    });
  });

  it("member token: an app-wide consent sends no purpose", async () => {
    const { calls, doFetch } = recorder(() => tokenResponse());
    await auth(doFetch).memberToken({ installation: "gapp_abc", member: "uapp_alice" });
    const body = form(calls[0]);
    expect(body.map(([name]) => name)).toEqual(["grant_type", "assertion"]);
    expect(decode(body[1][1].split(".")[1])).not.toHaveProperty("purpose");
  });

  it("refuses an initiative id that is not a positive whole number", async () => {
    const { calls, doFetch } = recorder(() => tokenResponse());
    for (const initiativeId of [0, -1, 1.5, Number.NaN]) {
      await expect(
        auth(doFetch).installationToken({ installation: "gapp_abc", initiativeId })
      ).rejects.toThrow(TypeError);
    }
    expect(calls).toHaveLength(0);
    expect(initiativeResource(9)).toBe("urn:initiative:initiative:9");
  });

  it("requires the installation and the member", async () => {
    const { doFetch } = recorder(() => tokenResponse());
    await expect(auth(doFetch).installationToken({ installation: "" })).rejects.toThrow(
      /installation/
    );
    await expect(
      auth(doFetch).memberToken({ installation: "gapp_abc", member: "" })
    ).rejects.toThrow(/member/);
  });

  it("refuses an alg that does not match the key", () => {
    expect(
      () =>
        new InitiativeAuth({
          baseUrl: BASE,
          clientId: CLIENT,
          privateKey: keys.RS256.privateKeyPem,
          kid: "rsa-1",
          alg: "ES256",
        })
    ).toThrow(/does not match/);
  });

  describe("caching", () => {
    it("reuses a token until 30 seconds before it expires", async () => {
      let issued = 0;
      const { calls, doFetch } = recorder(() => tokenResponse(`iat_${++issued}`));
      const client = auth(doFetch);

      expect((await client.installationToken({ installation: "gapp_abc" })).token).toBe("iat_1");
      now += 569_000;
      expect((await client.installationToken({ installation: "gapp_abc" })).token).toBe("iat_1");
      now += 1_000; // exactly 30 s before expiry
      expect((await client.installationToken({ installation: "gapp_abc" })).token).toBe("iat_2");
      expect(calls).toHaveLength(2);
    });

    it("keys the cache by kind, installation, member, purpose, scopes and initiative", async () => {
      let issued = 0;
      const { calls, doFetch } = recorder(() => tokenResponse(`iat_${++issued}`));
      const client = auth(doFetch);

      await client.appToken();
      await client.installationToken({ installation: "gapp_a" });
      await client.installationToken({ installation: "gapp_b" });
      await client.installationToken({ installation: "gapp_a", scopes: ["tags:read"] });
      await client.installationToken({ installation: "gapp_a", initiativeId: 1 });
      await client.installationToken({ installation: "gapp_a", initiativeId: 2 });
      await client.memberToken({ installation: "gapp_a", member: "uapp_1" });
      await client.memberToken({ installation: "gapp_a", member: "uapp_2" });
      await client.memberToken({ installation: "gapp_a", member: "uapp_1", purpose: "p" });
      expect(calls).toHaveLength(9);

      // Every one of them again: all cached.
      await client.appToken();
      await client.installationToken({ installation: "gapp_a" });
      await client.installationToken({ installation: "gapp_a", scopes: ["tags:read"] });
      await client.installationToken({ installation: "gapp_a", initiativeId: 2 });
      await client.memberToken({ installation: "gapp_a", member: "uapp_1", purpose: "p" });
      expect(calls).toHaveLength(9);
    });

    it("treats one scope set in any order as the same token", async () => {
      const { calls, doFetch } = recorder(() => tokenResponse());
      const client = auth(doFetch);
      await client.installationToken({ installation: "gapp_a", scopes: ["a:read", "b:read"] as never });
      await client.installationToken({ installation: "gapp_a", scopes: ["b:read", "a:read"] as never });
      expect(calls).toHaveLength(1);
    });

    it("shares one request between concurrent callers", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const { calls, doFetch } = recorder(async () => {
        await gate;
        return tokenResponse("iat_shared");
      });
      const client = auth(doFetch);

      const pending = [1, 2, 3].map(() => client.installationToken({ installation: "gapp_a" }));
      release();
      const tokens = await Promise.all(pending);
      expect(tokens.map((token) => token.token)).toEqual(["iat_shared", "iat_shared", "iat_shared"]);
      expect(calls).toHaveLength(1);
    });

    it("caches nothing when the request fails, and tries again next time", async () => {
      const { calls, doFetch } = recorder((_call, index) =>
        index === 0 ? json({ error: "invalid_client" }, 401) : tokenResponse("iat_ok")
      );
      const client = auth(doFetch);
      await expect(client.installationToken({ installation: "gapp_a" })).rejects.toThrow(
        InitiativeAuthError
      );
      expect((await client.installationToken({ installation: "gapp_a" })).token).toBe("iat_ok");
      expect(calls).toHaveLength(2);
    });

    it("does not cache a token that states no lifetime", async () => {
      const { calls, doFetch } = recorder(() =>
        json({ access_token: "iat_x", token_type: "Bearer" })
      );
      const client = auth(doFetch);
      await client.appToken();
      await client.appToken();
      expect(calls).toHaveLength(2);
    });
  });

  describe("errors", () => {
    it("carries the RFC 6749 error and its description", async () => {
      for (const [error, status] of [
        ["invalid_client", 401],
        ["invalid_grant", 400],
        ["invalid_scope", 400],
      ] as const) {
        const { doFetch } = recorder(() =>
          json({ error, error_description: `about ${error}` }, status)
        );
        const failure = await auth(doFetch)
          .installationToken({ installation: "gapp_a" })
          .catch((caught) => caught);
        expect(failure).toBeInstanceOf(InitiativeAuthError);
        expect(failure).not.toBeInstanceOf(ConsentRequiredError);
        expect(failure.error).toBe(error);
        expect(failure.errorDescription).toBe(`about ${error}`);
        expect(failure.status).toBe(status);
      }
    });

    it("gives consent_required its own class", async () => {
      const { doFetch } = recorder(() =>
        json({ error: "consent_required", error_description: "ask the member" }, 400)
      );
      const failure = await auth(doFetch)
        .memberToken({ installation: "gapp_a", member: "uapp_1", purpose: "node-7" })
        .catch((caught) => caught);
      expect(failure).toBeInstanceOf(ConsentRequiredError);
      expect(failure).toBeInstanceOf(InitiativeAuthError);
      expect(failure.error).toBe("consent_required");
      expect(failure.errorDescription).toBe("ask the member");
    });

    it("names a response that is not an OAuth error", async () => {
      const { doFetch } = recorder(() => new Response("gateway down", { status: 502 }));
      const failure = await auth(doFetch).appToken().catch((caught) => caught);
      expect(failure).toBeInstanceOf(InitiativeAuthError);
      expect(failure.error).toBe("invalid_response");
      expect(failure.status).toBe(502);
    });

    it("refuses a success with no access token, or not a bearer token", async () => {
      for (const body of [{ token_type: "Bearer", expires_in: 600 }, { access_token: "x", token_type: "mac" }]) {
        const { doFetch } = recorder(() => json(body));
        const failure = await auth(doFetch).appToken().catch((caught) => caught);
        expect(failure).toBeInstanceOf(InitiativeAuthError);
        expect(failure.error).toBe("invalid_response");
      }
    });
  });

  describe("calling Initiative", () => {
    it("lists installations with the app token", async () => {
      const { calls, doFetch } = recorder((call) =>
        call.url === TOKEN_URL
          ? tokenResponse("iat_app")
          : json([
              { installation: "gapp_a", scopes: ["projects:read"], initiatives: [1, 2], active: true },
              { installation: "gapp_b", scopes: [], initiatives: [], active: false },
            ])
      );
      const installations = await auth(doFetch).listInstallations();

      expect(calls[1].url).toBe(`${BASE}/app-platform/installations`);
      expect(calls[1].method).toBe("GET");
      expect(calls[1].headers.get("authorization")).toBe("Bearer iat_app");
      expect(installations).toEqual([
        { installation: "gapp_a", scopes: ["projects:read"], initiatives: [1, 2], active: true },
        { installation: "gapp_b", scopes: [], initiatives: [], active: false },
      ]);
    });

    it("reads an installation without an active flag as active", async () => {
      const { doFetch } = recorder((call) =>
        call.url === TOKEN_URL
          ? tokenResponse("iat_app")
          : json([{ installation: "gapp_a", scopes: [], initiatives: [] }])
      );
      const [installation] = await auth(doFetch).listInstallations();
      expect(installation.active).toBe(true);
    });

    it("raises an API error for a refused listing", async () => {
      const { doFetch } = recorder((call) =>
        call.url === TOKEN_URL ? tokenResponse() : json({ detail: "APP_DISABLED" }, 403)
      );
      const failure = await auth(doFetch).listInstallations().catch((caught) => caught);
      expect(failure).toBeInstanceOf(InitiativeApiError);
      expect(failure.status).toBe(403);
      expect(failure.detail).toBe("APP_DISABLED");
    });

    it("requests consent with an installation token for that installation", async () => {
      const { calls, doFetch } = recorder((call) =>
        call.url === TOKEN_URL ? tokenResponse("iat_inst") : json({ status: "pending" }, 201)
      );
      const answer = await auth(doFetch).requestConsent({
        installation: "gapp_a",
        member: "uapp_1",
        purpose: "node-7",
        label: "Comment on linked issues as you",
        initiativeId: 5,
        access: "read_write",
      });

      expect(new URLSearchParams(calls[0].body).get("installation")).toBe("gapp_a");
      expect(new URLSearchParams(calls[0].body).has("resource")).toBe(false);
      expect(calls[1].url).toBe(`${BASE}/app-platform/consent-requests`);
      expect(calls[1].method).toBe("POST");
      expect(calls[1].headers.get("authorization")).toBe("Bearer iat_inst");
      expect(calls[1].headers.get("content-type")).toBe("application/json");
      expect(JSON.parse(calls[1].body)).toEqual({
        member: "uapp_1",
        label: "Comment on linked issues as you",
        access: "read_write",
        purpose: "node-7",
        initiative_id: 5,
      });
      expect(answer).toEqual({ status: "pending" });
    });

    it("fetches as an installation, narrowed as asked", async () => {
      const { calls, doFetch } = recorder((call) =>
        call.url === TOKEN_URL ? tokenResponse("iat_narrow") : json([])
      );
      await auth(doFetch).fetchAsInstallation(
        "gapp_a",
        guildPath("/projects/"),
        { headers: { Accept: "application/json" } },
        { scopes: ["projects:read"], initiativeId: 7 }
      );

      expect(form(calls[0]).slice(3)).toEqual([
        ["installation", "gapp_a"],
        ["scope", "projects:read"],
        ["resource", "urn:initiative:initiative:7"],
      ]);
      expect(calls[1].url).toBe(`${BASE}/c/0/projects/`);
      expect(calls[1].headers.get("authorization")).toBe("Bearer iat_narrow");
      expect(calls[1].headers.get("accept")).toBe("application/json");
    });

    it("drops a cached token that Initiative answers 401 to", async () => {
      let issued = 0;
      const { calls, doFetch } = recorder((call) =>
        call.url === TOKEN_URL ? tokenResponse(`iat_${++issued}`) : json({}, 401)
      );
      const client = auth(doFetch);
      await client.fetchAsInstallation("gapp_a", guildPath("projects/"));
      await client.fetchAsInstallation("gapp_a", guildPath("projects/"));
      expect(calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(2);
      expect(calls[3].headers.get("authorization")).toBe("Bearer iat_2");
    });
  });
});

describe("the installation's own calls", () => {
  const INSTALLATION = `${BASE}/app-platform/installation`;

  const auth = (doFetch: typeof fetch) =>
    new InitiativeAuth({
      baseUrl: BASE,
      clientId: CLIENT,
      privateKey: keys.RS256.privateKeyPem,
      kid: keys.RS256.kid,
      fetch: doFetch,
      clock: () => NOW,
    });

  const connection = {
    connection_id: "github",
    connection_ref: "cr_1",
    status: "connected",
    blocked: false,
    account_label: "@alice",
    created_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:00Z",
  };

  const expected = {
    connectionId: "github",
    connectionRef: "cr_1",
    status: "connected",
    blocked: false,
    accountLabel: "@alice",
    createdAt: "2026-09-24T00:00:00Z",
    updatedAt: "2026-09-24T00:00:00Z",
  };

  it("reads the configuration with an unnarrowed installation token", async () => {
    const { calls, doFetch } = recorder((call) =>
      call.url === TOKEN_URL
        ? tokenResponse("iat_inst")
        : json({
            guild_ref: "gapp_a",
            install_id: 4,
            listing_uid: "K7M2QX8N4TVB9C",
            listing_version: "1.0.0",
            enabled: true,
            config_state: "unverified",
            config_state_detail: null,
            needs_config: false,
            connections: { admin: { admin_token: "shpat_1" } },
            connection_refs: { workspace: "gcr_1" },
            member_connections: [
              {
                connection_id: "github",
                connection_ref: "cr_1",
                status: "connected",
                values: { login: "alice" },
              },
            ],
          })
    );
    const config = await auth(doFetch).installationConfig("gapp_a");

    expect(form(calls[0]).slice(3)).toEqual([["installation", "gapp_a"]]);
    expect(calls[1].url).toBe(`${INSTALLATION}/config`);
    expect(calls[1].method).toBe("GET");
    expect(calls[1].headers.get("authorization")).toBe("Bearer iat_inst");
    expect(config).toEqual({
      guildRef: "gapp_a",
      installId: 4,
      listingUid: "K7M2QX8N4TVB9C",
      listingVersion: "1.0.0",
      enabled: true,
      configState: "unverified",
      configStateDetail: null,
      needsConfig: false,
      connections: { admin: { admin_token: "shpat_1" } },
      connectionRefs: { workspace: "gcr_1" },
      memberConnections: [
        {
          connectionId: "github",
          connectionRef: "cr_1",
          status: "connected",
          values: { login: "alice" },
        },
      ],
    });
  });

  it("lists the connections", async () => {
    const { calls, doFetch } = recorder((call) =>
      call.url === TOKEN_URL ? tokenResponse() : json({ items: [connection] })
    );
    const items = await auth(doFetch).installationConnections("gapp_a");

    expect(calls[1].url).toBe(`${INSTALLATION}/connections`);
    expect(items).toEqual([expected]);
  });

  it("asks for a connection's access token by its handle", async () => {
    const { calls, doFetch } = recorder((call) =>
      call.url === TOKEN_URL
        ? tokenResponse()
        : json({ access_token: "gho_2", expires_at: 1_780_000_600 })
    );
    const token = await auth(doFetch).connectionToken("gapp_a", "cr/1");

    expect(calls[1].url).toBe(`${INSTALLATION}/connections/cr%2F1/token`);
    expect(calls[1].method).toBe("POST");
    expect(token).toEqual({ accessToken: "gho_2", expiresAt: 1_780_000_600_000 });
  });

  it("reports a token with no expiry as null", async () => {
    const { doFetch } = recorder((call) =>
      call.url === TOKEN_URL ? tokenResponse() : json({ access_token: "gho_3", expires_at: null })
    );
    const token = await auth(doFetch).connectionToken("gapp_a", "cr_1");
    expect(token).toEqual({ accessToken: "gho_3", expiresAt: null });
  });

  it("raises Initiative's refusal of a connection token", async () => {
    const { doFetch } = recorder((call) =>
      call.url === TOKEN_URL
        ? tokenResponse()
        : json({ detail: "APP_CHANNEL_CONNECTION_EXPIRED" }, 409)
    );
    const failure = await auth(doFetch)
      .connectionToken("gapp_a", "cr_1")
      .catch((caught) => caught);
    expect(failure).toBeInstanceOf(InitiativeApiError);
    expect(failure.status).toBe(409);
    expect(failure.detail).toBe("APP_CHANNEL_CONNECTION_EXPIRED");
  });

  it("reports the configuration's status", async () => {
    const { calls, doFetch } = recorder((call) =>
      call.url === TOKEN_URL
        ? tokenResponse()
        : json({
            guild_ref: "gapp_a",
            install_id: 4,
            config_state: "invalid",
            config_state_detail: "missing_scope",
          })
    );
    const recorded = await auth(doFetch).reportConfigStatus("gapp_a", {
      state: "invalid",
      detail: "missing_scope",
    });

    expect(calls[1].url).toBe(`${INSTALLATION}/config-status`);
    expect(calls[1].method).toBe("POST");
    expect(JSON.parse(calls[1].body)).toEqual({ state: "invalid", detail: "missing_scope" });
    expect(recorded).toEqual({
      guildRef: "gapp_a",
      installId: 4,
      configState: "invalid",
      configStateDetail: "missing_scope",
    });
  });

  it("emits an event, with an empty payload when none is given", async () => {
    const { calls, doFetch } = recorder((call) =>
      call.url === TOKEN_URL ? tokenResponse() : json({ status: "accepted" }, 202)
    );
    await auth(doFetch).emitEvent("gapp_a", { eventType: "app.acme.tracker.created" });

    expect(calls[1].url).toBe(`${INSTALLATION}/events`);
    expect(calls[1].method).toBe("POST");
    expect(JSON.parse(calls[1].body)).toEqual({
      event_type: "app.acme.tracker.created",
      payload: {},
    });
  });

  it("raises Initiative's detail on a refusal", async () => {
    const { doFetch } = recorder((call) =>
      call.url === TOKEN_URL
        ? tokenResponse()
        : json({ detail: "APP_CHANNEL_CONNECTION_NOT_FOUND" }, 404)
    );
    const failure = await auth(doFetch)
      .installationConnections("gapp_a")
      .catch((caught) => caught);

    expect(failure).toBeInstanceOf(InitiativeApiError);
    expect(failure.status).toBe(404);
    expect(failure.detail).toBe("APP_CHANNEL_CONNECTION_NOT_FOUND");
  });

  it("requires the installation", async () => {
    const { doFetch } = recorder(() => tokenResponse());
    await expect(auth(doFetch).installationConfig("")).rejects.toThrow(TypeError);
  });
});

describe("calling another app", () => {
  const HUB = `${BASE}/app-platform/apps/acme.github/endpoints/app.acme.github.open_issue`;
  const outcome = {
    endpoint: "app.acme.github.open_issue",
    actor: "installation",
    result: { number: 7 },
  };

  const auth = (doFetch: typeof fetch) =>
    new InitiativeAuth({
      baseUrl: BASE,
      clientId: CLIENT,
      privateKey: keys.RS256.privateKeyPem,
      kid: keys.RS256.kid,
      fetch: doFetch,
      clock: () => NOW,
    });

  it("posts the params to Initiative on the installation token", async () => {
    const { calls, doFetch } = recorder((call) =>
      call.url === TOKEN_URL ? tokenResponse("iat_inst") : json(outcome)
    );
    const answer = await auth(doFetch).callApp(
      "gapp_a",
      "acme.github",
      "app.acme.github.open_issue",
      { title: "Broken" }
    );

    expect(form(calls[0]).slice(3)).toEqual([["installation", "gapp_a"]]);
    expect(calls[1].url).toBe(HUB);
    expect(calls[1].method).toBe("POST");
    expect(calls[1].headers.get("authorization")).toBe("Bearer iat_inst");
    expect(JSON.parse(calls[1].body)).toEqual({ params: { title: "Broken" } });
    expect(answer).toEqual(outcome);
  });

  it("goes on a member token when given a member", async () => {
    const { calls, doFetch } = recorder((call) =>
      call.url === TOKEN_URL ? tokenResponse("mat_1") : json({ ...outcome, actor: "member" })
    );
    const answer = await auth(doFetch).callApp(
      "gapp_a",
      "acme.github",
      "app.acme.github.open_issue",
      {},
      { member: "uapp_m", purpose: "automations", initiativeId: 3 }
    );

    const grant = form(calls[0]);
    expect(grant[0]).toEqual(["grant_type", JWT_BEARER_GRANT]);
    expect(grant).toContainEqual(["resource", initiativeResource(3)]);
    const assertion = decode(grant[1][1].split(".")[1]);
    expect(assertion.sub).toBe("uapp_m");
    expect(assertion.installation).toBe("gapp_a");
    expect(assertion.purpose).toBe("automations");
    expect(calls[1].headers.get("authorization")).toBe("Bearer mat_1");
    expect(JSON.parse(calls[1].body)).toEqual({ params: {} });
    expect(answer.actor).toBe("member");
  });

  it("confines an installation call to an initiative", async () => {
    const { calls, doFetch } = recorder((call) =>
      call.url === TOKEN_URL ? tokenResponse() : json(outcome)
    );
    await auth(doFetch).callApp("gapp_a", "acme.github", "app.acme.github.open_issue", {}, {
      initiativeId: 5,
    });
    expect(form(calls[0])).toContainEqual(["resource", initiativeResource(5)]);
  });

  it("raises Initiative's refusal with its code", async () => {
    const { doFetch } = recorder((call) =>
      call.url === TOKEN_URL ? tokenResponse() : json({ detail: "insufficient_scope" }, 403)
    );
    const failure = await auth(doFetch)
      .callApp("gapp_a", "acme.github", "app.acme.github.open_issue")
      .catch((caught) => caught);

    expect(failure).toBeInstanceOf(InitiativeApiError);
    expect(failure.status).toBe(403);
    expect(failure.detail).toBe("insufficient_scope");
  });

  it("drops a member token Initiative no longer accepts", async () => {
    let issued = 0;
    const { calls, doFetch } = recorder((call) => {
      if (call.url === TOKEN_URL) return tokenResponse(`mat_${++issued}`);
      return issued === 1 ? json({ detail: "invalid_token" }, 401) : json(outcome);
    });
    const client = auth(doFetch);
    const call = () =>
      client.callApp("gapp_a", "acme.github", "app.acme.github.open_issue", {}, {
        member: "uapp_m",
      });
    await expect(call()).rejects.toBeInstanceOf(InitiativeApiError);
    await call();
    expect(calls.filter((one) => one.url === TOKEN_URL)).toHaveLength(2);
  });

  it("refuses an answer that carries no result", async () => {
    const { doFetch } = recorder((call) =>
      call.url === TOKEN_URL ? tokenResponse() : json({ endpoint: "x" })
    );
    await expect(
      auth(doFetch).callApp("gapp_a", "acme.github", "app.acme.github.open_issue")
    ).rejects.toBeInstanceOf(InitiativeApiError);
  });

  it("requires the app and the endpoint", async () => {
    const { doFetch } = recorder(() => tokenResponse());
    await expect(auth(doFetch).callApp("gapp_a", "", "x")).rejects.toThrow(TypeError);
    await expect(auth(doFetch).callApp("gapp_a", "acme.github", "")).rejects.toThrow(TypeError);
  });
});

describe("guildPath", () => {
  it("writes 0 in the community segment", () => {
    expect(guildPath("/projects/")).toBe("/c/0/projects/");
    expect(guildPath("tasks/12")).toBe("/c/0/tasks/12");
  });

  it("refuses a path that already has a community segment", () => {
    expect(() => guildPath("/c/12/projects/")).toThrow(TypeError);
  });
});
