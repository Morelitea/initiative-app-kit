/**
 * Verifying a token issued for a delegated call.
 *
 * One keypair, generated per run rather than committed, served from a stub
 * `fetch` at the one document a deployment publishes —
 * `/api/v1/app-platform/jwks.json`. That is the shape now: one issuer, one key
 * set, because the token an app receives is minted by the deployment rather
 * than by the delegate that asked for it.
 *
 * The test that matters most is that attribution comes out of `act`. A caller
 * may also name itself in a header, and nothing is read from it — the claim is
 * inside the signature and the header is not.
 */

import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { JWKS_PATH, JwksCache, audienceFor } from "../src/context.js";
import {
  DELEGATE_HEADER,
  DelegationTokenError,
  delegateHeader,
  verifyDelegationToken,
} from "../src/delegation.js";

const PUBLIC_ID = "morelitea.github";
const AUTO = "morelitea.auto";
const BASE = "https://initiative.example.internal";
const NOW = 1_700_000_000_000;

let deployment: { privateKey: KeyObject; jwk: Record<string, unknown> };

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  deployment = {
    privateKey: pair.privateKey,
    jwk: { ...(pair.publicKey.export({ format: "jwk" }) as object), kid: "signing-1" },
  };
});

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("base64url");
}

function token(
  claims: Record<string, unknown> = {},
  options: { kid?: string; alg?: string; signAs?: KeyObject } = {}
): string {
  const header = b64({
    alg: options.alg ?? "RS256",
    typ: "JWT",
    kid: options.kid ?? "signing-1",
  });
  const payload = b64({
    jti: "one-shot-1",
    iss: "initiative",
    aud: audienceFor(PUBLIC_ID),
    sub: "uapp_thisappsownrefforthemember",
    guild_ref: "gapp_thisappsownrefforthisguild",
    app_install_id: 42,
    act: { public_id: AUTO },
    iat: Math.floor(NOW / 1000) - 5,
    exp: Math.floor(NOW / 1000) + 900,
    ...claims,
  });
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const key = options.signAs ?? deployment.privateKey;
  return `${header}.${payload}.${signer.sign(key).toString("base64url")}`;
}

/** A deployment publishing its one key set. */
function published(keys?: unknown[]) {
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    if (new URL(String(url)).pathname === JWKS_PATH) {
      return new Response(JSON.stringify({ keys: keys ?? [deployment.jwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
  }) as unknown as typeof globalThis.fetch;

  return { fetchImpl, jwks: new JwksCache({ fetchImpl, now: () => NOW }) };
}

const verify = (
  raw: string,
  jwks: JwksCache,
  options: Record<string, unknown> = {}
) =>
  verifyDelegationToken(raw, {
    publicId: PUBLIC_ID,
    baseUrl: BASE,
    jwks,
    now: () => NOW,
    ...options,
  });

describe("a delegated call", () => {
  it("verifies against the deployment's published key", async () => {
    const { jwks } = published();
    await expect(verify(token(), jwks)).resolves.toMatchObject({
      subject: "uapp_thisappsownrefforthemember",
    });
  });

  it("names the member, the guild and the install as this app knows them", async () => {
    const { jwks } = published();
    const claims = await verify(token(), jwks);
    // All three are minted at this install, so they are the same values a
    // context token carries and what this app's own rows key on.
    expect(claims.subject).toBe("uapp_thisappsownrefforthemember");
    expect(claims.guildRef).toBe("gapp_thisappsownrefforthisguild");
    expect(claims.appInstallId).toBe(42);
  });

  it("is attributed to the app named in the signed claim", async () => {
    const { jwks } = published();
    expect((await verify(token(), jwks)).actor).toEqual({ publicId: AUTO });
  });

  it("ignores a header that disagrees with the claim", async () => {
    // The header is a routing hint. Attribution is read from inside the
    // signature, so naming somebody else in it changes nothing.
    const { jwks } = published();
    const claims = await verify(token(), jwks, { delegate: "someone.else" });
    expect(claims.actor.publicId).toBe(AUTO);
  });

  it("carries the member's own handles when they have any", async () => {
    const { jwks } = published();
    const claims = await verify(
      token({ connection_refs: { account: "cr_thisappshandleforthem" } }),
      jwks
    );
    expect(claims.connectionRefs).toEqual({ account: "cr_thisappshandleforthem" });
  });

  it("says nothing rather than an empty object when they have none", async () => {
    const { jwks } = published();
    expect((await verify(token(), jwks)).connectionRefs).toBeUndefined();
  });

  it("refuses handles that are not handles", async () => {
    const { jwks } = published();
    await expect(verify(token({ connection_refs: [] }), jwks)).rejects.toThrow(
      DelegationTokenError
    );
    await expect(
      verify(token({ connection_refs: { account: 7 } }), jwks)
    ).rejects.toThrow(DelegationTokenError);
  });

  it("hands back the jti, because the one-shot rule is the app's to keep", async () => {
    const { jwks } = published();
    expect((await verify(token(), jwks)).jti).toBe("one-shot-1");
  });

  it("pins the issuer when it is given one", async () => {
    const { jwks } = published();
    await expect(verify(token(), jwks, { issuer: "somebody-else" })).rejects.toThrow(
      DelegationTokenError
    );
    await expect(verify(token(), jwks, { issuer: "initiative" })).resolves.toBeTruthy();
  });

  it("reads the header a caller may name itself in", () => {
    expect(delegateHeader({ [DELEGATE_HEADER]: AUTO })).toBe(AUTO);
    expect(delegateHeader({})).toBeNull();
  });
});

describe("what it refuses", () => {
  it("a token signed by anybody but the deployment", async () => {
    const { jwks } = published();
    const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    await expect(verify(token({}, { signAs: stranger }), jwks)).rejects.toThrow(
      DelegationTokenError
    );
  });

  it("a token addressed to a different app", async () => {
    const { jwks } = published();
    await expect(
      verify(token({ aud: audienceFor("somebody.else") }), jwks)
    ).rejects.toThrow(DelegationTokenError);
  });

  it("a token addressed to Initiative rather than to an app", async () => {
    const { jwks } = published();
    await expect(
      verify(token({ aud: "initiative:auto-delegation" }), jwks)
    ).rejects.toThrow(DelegationTokenError);
  });

  it("an algorithm it was not expecting", async () => {
    const { jwks } = published();
    await expect(verify(token({}, { alg: "none" }), jwks)).rejects.toThrow(
      DelegationTokenError
    );
  });

  it("a token naming a key the deployment does not publish", async () => {
    const { jwks } = published();
    await expect(verify(token({}, { kid: "not-published" }), jwks)).rejects.toThrow(
      DelegationTokenError
    );
  });

  it("a token with no kid at all", async () => {
    const { jwks } = published();
    const raw = token();
    const [, payload, signature] = raw.split(".");
    const header = b64({ alg: "RS256", typ: "JWT" });
    await expect(verify(`${header}.${payload}.${signature}`, jwks)).rejects.toThrow(
      DelegationTokenError
    );
  });

  it("an expired token, and one from the future", async () => {
    const { jwks } = published();
    await expect(
      verify(token({ exp: Math.floor(NOW / 1000) - 600 }), jwks)
    ).rejects.toThrow(DelegationTokenError);
    await expect(
      verify(token({ iat: Math.floor(NOW / 1000) + 600 }), jwks)
    ).rejects.toThrow(DelegationTokenError);
  });

  it("a token that could not be one-shot", async () => {
    const { jwks } = published();
    await expect(verify(token({ jti: undefined }), jwks)).rejects.toThrow(
      DelegationTokenError
    );
  });

  it("a token naming no guild, no member, or no install", async () => {
    const { jwks } = published();
    await expect(verify(token({ guild_ref: undefined }), jwks)).rejects.toThrow(
      DelegationTokenError
    );
    await expect(verify(token({ sub: undefined }), jwks)).rejects.toThrow(
      DelegationTokenError
    );
    await expect(verify(token({ app_install_id: "42" }), jwks)).rejects.toThrow(
      DelegationTokenError
    );
  });

  it("a token that says nobody is acting", async () => {
    const { jwks } = published();
    await expect(verify(token({ act: undefined }), jwks)).rejects.toThrow(
      DelegationTokenError
    );
    await expect(verify(token({ act: { public_id: "not a public id" } }), jwks))
      .rejects.toThrow(DelegationTokenError);
  });

  it("something that is not a JWT at all", async () => {
    const { jwks } = published();
    await expect(verify("hello", jwks)).rejects.toThrow(DelegationTokenError);
  });
});

describe("the published document", () => {
  it("is fetched once and reused", async () => {
    const { fetchImpl, jwks } = published();
    await verify(token(), jwks);
    await verify(token(), jwks);
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it("says the same thing for every reason a key is unusable", async () => {
    const { jwks } = published([]);
    await expect(verify(token(), jwks)).rejects.toThrow(DelegationTokenError);
  });

  it("reports a fetch that failed as a fetch that failed", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("the network said no");
    }) as unknown as typeof globalThis.fetch;
    const jwks = new JwksCache({ fetchImpl, now: () => NOW });
    await expect(verify(token(), jwks)).rejects.toThrow(DelegationTokenError);
  });
});
