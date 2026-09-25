/**
 * Verifying the tokens Initiative signs: the per-call context token and the
 * page handoff token. Each is signed here with a test key standing in for the
 * deployment's, and published through an injected JWKS fetch.
 */

import { describe, expect, it } from "vitest";

import {
  ContextTokenError,
  JWKS_PATH,
  JwksCache,
  audienceFor,
  bearerToken,
  verifyContextToken,
  verifyHandoffToken,
  verifyLifecycleToken,
} from "../src/context.js";
import { generateAppKeys, loadPrivateKey, signJwt } from "../src/keys.js";

const BASE = "https://initiative.example.com";
const PUBLIC_ID = "acme.tracker";
const NOW = 1_780_000_000;

const platform = generateAppKeys({ alg: "RS256", kid: "platform-1" });
const signing = loadPrivateKey(platform.privateKeyPem, "platform-1");

function jwksFetch(documents: Array<{ keys: unknown[] }> = [platform.jwks]) {
  const urls: string[] = [];
  let index = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    urls.push(String(input));
    const body = documents[Math.min(index++, documents.length - 1)];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { urls, fetchImpl };
}

function claims(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jti: "j-1",
    iss: "initiative",
    aud: audienceFor(PUBLIC_ID),
    iat: NOW,
    exp: NOW + 60,
    guild_ref: "gapp_abc",
    app_install_id: 7,
    ...extra,
  };
}

const contextClaims = (extra: Record<string, unknown> = {}) =>
  claims({ scope: "endpoint", endpoint_id: "app.acme.tracker.read", ...extra });

const lifecycleClaims = (extra: Record<string, unknown> = {}) =>
  claims({ scope: "lifecycle", hook: "after_connect", ...extra });

const handoffClaims = (extra: Record<string, unknown> = {}) =>
  claims({ sub: "uapp_alice", surface_id: "panel", initiative_id: 3, ...extra });

function options(fetchImpl: typeof fetch) {
  return {
    publicId: PUBLIC_ID,
    baseUrl: BASE,
    jwks: new JwksCache({ fetchImpl, now: () => NOW * 1000 }),
    now: () => NOW * 1000,
  };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const failure = await promise.then(
    () => null,
    (caught) => caught
  );
  expect(failure).toBeInstanceOf(ContextTokenError);
  return (failure as Error).message;
}

describe("verifyContextToken", () => {
  it("returns the claims of a token Initiative signed for this app", async () => {
    const { urls, fetchImpl } = jwksFetch();
    const token = signJwt(signing, contextClaims({ connection_refs: { account: "ref-1" } }));
    const verified = await verifyContextToken(token, options(fetchImpl));
    expect(verified).toMatchObject({
      guild_ref: "gapp_abc",
      app_install_id: 7,
      scope: "endpoint",
      endpoint_id: "app.acme.tracker.read",
      connection_refs: { account: "ref-1" },
    });
    expect(urls).toEqual([`${BASE}${JWKS_PATH}`]);
  });

  it("names the calling app, the actor and the member on a call from another app", async () => {
    const { fetchImpl } = jwksFetch();
    const token = signJwt(
      signing,
      contextClaims({
        act: { sub: "acme.automations" },
        actor: "member",
        member: "uapp_target_ref",
        initiative_id: 4,
        connection_refs: { account: "ref-m" },
      })
    );
    const verified = await verifyContextToken(token, options(fetchImpl));
    expect(verified.act).toEqual({ sub: "acme.automations" });
    expect(verified.actor).toBe("member");
    expect(verified.member).toBe("uapp_target_ref");
    expect(verified.initiative_id).toBe(4);
  });

  it("leaves the caller claims absent on Initiative's own call", async () => {
    const { fetchImpl } = jwksFetch();
    const verified = await verifyContextToken(signJwt(signing, contextClaims()), options(fetchImpl));
    expect(verified.act).toBeUndefined();
    expect(verified.actor).toBeUndefined();
    expect(verified.member).toBeUndefined();
  });

  it("refuses caller claims of the wrong shape", async () => {
    const { fetchImpl } = jwksFetch();
    for (const [extra, message] of [
      [{ act: "acme.automations" }, "act names no calling app"],
      [{ act: { sub: "" } }, "act names no calling app"],
      [{ actor: "robot" }, "unknown actor robot"],
      [{ actor: "member" }, "a member call names no member"],
      [{ initiative_id: 0 }, "initiative_id is not an initiative"],
    ] as const) {
      const token = signJwt(signing, contextClaims(extra));
      expect(await refusal(verifyContextToken(token, options(fetchImpl)))).toBe(message);
    }
  });

  it("finds the JWKS from the API base too", async () => {
    const { urls, fetchImpl } = jwksFetch();
    await verifyContextToken(signJwt(signing, contextClaims()), {
      ...options(fetchImpl),
      baseUrl: `${BASE}/api/v1`,
    });
    expect(urls).toEqual([`${BASE}${JWKS_PATH}`]);
  });

  it("refuses a token for another app", async () => {
    const { fetchImpl } = jwksFetch();
    const token = signJwt(signing, contextClaims({ aud: audienceFor("other.app") }));
    expect(await refusal(verifyContextToken(token, options(fetchImpl)))).toContain(
      "initiative-app:other.app"
    );
  });

  it("refuses another issuer", async () => {
    const { fetchImpl } = jwksFetch();
    const token = signJwt(signing, contextClaims({ iss: "someone-else" }));
    expect(await refusal(verifyContextToken(token, options(fetchImpl)))).toContain(
      "someone-else"
    );
  });

  it("refuses an expired token, and one not valid yet, beyond the leeway", async () => {
    const { fetchImpl } = jwksFetch();
    const expired = signJwt(signing, contextClaims({ iat: NOW - 120, exp: NOW - 31 }));
    expect(await refusal(verifyContextToken(expired, options(fetchImpl)))).toContain("expired");
    const early = signJwt(signing, contextClaims({ iat: NOW + 31, exp: NOW + 90 }));
    expect(await refusal(verifyContextToken(early, options(fetchImpl)))).toContain("not valid yet");
    const withinLeeway = signJwt(signing, contextClaims({ iat: NOW - 90, exp: NOW - 29 }));
    await expect(verifyContextToken(withinLeeway, options(fetchImpl))).resolves.toBeTruthy();
  });

  it("refuses a signature by a key the deployment did not publish", async () => {
    const { fetchImpl } = jwksFetch();
    const stranger = generateAppKeys({ alg: "RS256" });
    const token = signJwt(loadPrivateKey(stranger.privateKeyPem, "platform-1"), contextClaims());
    expect(await refusal(verifyContextToken(token, options(fetchImpl)))).toContain(
      "did not verify"
    );
  });

  it("refuses any algorithm but RS256", async () => {
    const { fetchImpl } = jwksFetch();
    const ec = generateAppKeys({ alg: "ES256", kid: "platform-1" });
    const token = signJwt(loadPrivateKey(ec.privateKeyPem, "platform-1"), contextClaims());
    expect(await refusal(verifyContextToken(token, options(fetchImpl)))).toContain("ES256");
  });

  it("refuses a handoff token presented as a context token", async () => {
    const { fetchImpl } = jwksFetch();
    const token = signJwt(signing, handoffClaims());
    expect(await refusal(verifyContextToken(token, options(fetchImpl)))).toContain(
      "not a context token"
    );
  });

  it("refuses something that is not a JWT", async () => {
    const { fetchImpl } = jwksFetch();
    expect(await refusal(verifyContextToken("abc", options(fetchImpl)))).toBe("not a JWT");
    expect(await refusal(verifyContextToken("a.b.c", options(fetchImpl)))).toBe("not a JWT");
  });

  it("refetches once for an unknown kid, so a rotation resolves", async () => {
    const next = generateAppKeys({ alg: "RS256", kid: "platform-2" });
    const both = { keys: [...platform.jwks.keys, ...next.jwks.keys] };
    const { urls, fetchImpl } = jwksFetch([platform.jwks, both]);
    const opts = options(fetchImpl);

    await verifyContextToken(signJwt(signing, contextClaims()), opts);
    const rotated = signJwt(loadPrivateKey(next.privateKeyPem, "platform-2"), contextClaims());
    await verifyContextToken(rotated, opts);
    expect(urls).toHaveLength(2);

    // A kid nobody published, against a set that was itself refetched in this
    // window: refused without another fetch.
    const unknown = signJwt(loadPrivateKey(next.privateKeyPem, "platform-9"), contextClaims());
    expect(await refusal(verifyContextToken(unknown, opts))).toContain("platform-9");
    expect(await refusal(verifyContextToken(unknown, opts))).toContain("platform-9");
    expect(urls).toHaveLength(2);
  });
});

describe("verifyHandoffToken", () => {
  it("returns the member, the surface and the initiative", async () => {
    const { fetchImpl } = jwksFetch();
    const verified = await verifyHandoffToken(signJwt(signing, handoffClaims()), options(fetchImpl));
    expect(verified).toMatchObject({
      sub: "uapp_alice",
      surface_id: "panel",
      initiative_id: 3,
      guild_ref: "gapp_abc",
      app_install_id: 7,
      jti: "j-1",
    });
  });

  it("takes a community-level opening with no initiative", async () => {
    const { fetchImpl } = jwksFetch();
    const token = signJwt(signing, handoffClaims({ initiative_id: undefined }));
    const verified = await verifyHandoffToken(token, options(fetchImpl));
    expect(verified.initiative_id).toBeUndefined();
  });

  it("refuses a token naming no member or no surface", async () => {
    const { fetchImpl } = jwksFetch();
    expect(
      await refusal(
        verifyHandoffToken(signJwt(signing, handoffClaims({ sub: undefined })), options(fetchImpl))
      )
    ).toContain("no member");
    expect(
      await refusal(
        verifyHandoffToken(
          signJwt(signing, handoffClaims({ surface_id: undefined })),
          options(fetchImpl)
        )
      )
    ).toContain("no surface");
  });

  it("checks the audience like a context token", async () => {
    const { fetchImpl } = jwksFetch();
    const token = signJwt(signing, handoffClaims({ aud: audienceFor("other.app") }));
    await expect(verifyHandoffToken(token, options(fetchImpl))).rejects.toThrow(
      ContextTokenError
    );
  });
});

describe("bearerToken", () => {
  it("reads the bearer value and nothing else", () => {
    expect(bearerToken({ authorization: "Bearer abc" })).toBe("abc");
    expect(bearerToken({ Authorization: ["Bearer xyz"] })).toBe("xyz");
    expect(bearerToken({ authorization: "Basic abc" })).toBeNull();
    expect(bearerToken({ authorization: "Bearer " })).toBeNull();
    expect(bearerToken({})).toBeNull();
  });
});

describe("verifyLifecycleToken", () => {
  it("returns the claims of a hook call, naming the hook", async () => {
    const { fetchImpl } = jwksFetch();
    const verified = await verifyLifecycleToken(signJwt(signing, lifecycleClaims()), {
      ...options(fetchImpl),
      hook: "after_connect",
    });
    expect(verified).toMatchObject({
      scope: "lifecycle",
      hook: "after_connect",
      guild_ref: "gapp_abc",
      app_install_id: 7,
    });
  });

  it("refuses an endpoint token", async () => {
    const { fetchImpl } = jwksFetch();
    expect(
      await refusal(verifyLifecycleToken(signJwt(signing, contextClaims()), options(fetchImpl)))
    ).toMatch(/not a lifecycle token/);
  });

  it("refuses a token minted for another hook", async () => {
    const { fetchImpl } = jwksFetch();
    const token = signJwt(signing, lifecycleClaims({ hook: "revoke" }));
    expect(
      await refusal(verifyLifecycleToken(token, { ...options(fetchImpl), hook: "after_connect" }))
    ).toMatch(/for hook revoke, not after_connect/);
  });

  it("checks the audience and the clock like a context token", async () => {
    const { fetchImpl } = jwksFetch();
    const elsewhere = signJwt(signing, lifecycleClaims({ aud: audienceFor("acme.other") }));
    expect(await refusal(verifyLifecycleToken(elsewhere, options(fetchImpl)))).toMatch(
      /is for initiative-app:acme.other/
    );
    const stale = signJwt(signing, lifecycleClaims({ iat: NOW - 900, exp: NOW - 600 }));
    expect(await refusal(verifyLifecycleToken(stale, options(fetchImpl)))).toMatch(/expired/);
  });
});
