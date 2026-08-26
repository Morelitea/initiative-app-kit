/**
 * Verifying a delegate's token against the document a deployment publishes.
 *
 * Keypairs are generated per run rather than committed, so nothing here is a
 * key anybody could ever hold, and the key sets are served from a stub `fetch`
 * — one document per delegate, which is the shape
 * `/api/v1/app-platform/delegates/{public_id}/jwks.json` answers with.
 *
 * The test that matters most is the last one in "who signed": two delegates
 * publishing the same `kid`, backed by genuinely different keys, each resolving
 * to their own. That property is why the document is addressed per delegate,
 * and a merged key set could not hold it.
 */

import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { JwksCache, audienceFor } from "../src/context.js";
import {
  DELEGATE_HEADER,
  DelegationTokenError,
  delegateHeader,
  delegateJwksPath,
  verifyDelegationToken,
} from "../src/delegation.js";

const PUBLIC_ID = "morelitea.github";
const AUTO = "morelitea.auto";
const OTHER = "someone.else";
const BASE = "https://initiative.example.internal";
const NOW = 1_700_000_000_000;

interface Delegate {
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

const delegates: Record<string, Delegate> = {};

beforeAll(() => {
  // Both publish the *same* kid on purpose. It is an opaque label each picks,
  // and nothing on the platform side stops two apps picking one.
  for (const id of [AUTO, OTHER]) {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    delegates[id] = {
      privateKey: pair.privateKey,
      jwk: { ...(pair.publicKey.export({ format: "jwk" }) as object), kid: "signing-1" },
    };
  }
});

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("base64url");
}

function token(
  claims: Record<string, unknown> = {},
  options: { kid?: string; alg?: string; signAs?: string } = {}
): string {
  const header = b64({
    alg: options.alg ?? "RS256",
    typ: "JWT",
    kid: options.kid ?? "signing-1",
  });
  const payload = b64({
    jti: "one-shot-1",
    iss: "initiative-auto",
    aud: audienceFor(PUBLIC_ID),
    sub: "pairwise-abc",
    guild_id: 42,
    iat: Math.floor(NOW / 1000) - 5,
    exp: Math.floor(NOW / 1000) + 900,
    ...claims,
  });
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const key = delegates[options.signAs ?? AUTO].privateKey;
  return `${header}.${payload}.${signer.sign(key).toString("base64url")}`;
}

/**
 * A deployment publishing one document per delegate.
 *
 * `served` maps a public id to the keys its document holds; anything else is a
 * 404, which is what the platform answers for a registration that is unknown,
 * switched off, or does not hold the grant.
 */
function published(served: Record<string, unknown[]>) {
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    for (const [id, keys] of Object.entries(served)) {
      if (path === delegateJwksPath(id)) {
        return new Response(JSON.stringify({ keys }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
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
    delegate: AUTO,
    baseUrl: BASE,
    jwks,
    now: () => NOW,
    ...options,
  });

describe("a delegate's token", () => {
  it("verifies against that delegate's published key", async () => {
    const { jwks } = published({ [AUTO]: [delegates[AUTO].jwk] });
    const claims = await verify(token(), jwks);

    expect(claims.guildId).toBe(42);
    expect(claims.subject).toBe("pairwise-abc");
    expect(claims.jti).toBe("one-shot-1");
    expect(claims.issuer).toBe("initiative-auto");
  });

  it("is attributed to the delegate whose document held the key", async () => {
    const { jwks } = published({ [AUTO]: [delegates[AUTO].jwk] });
    expect((await verify(token(), jwks)).signer).toEqual({
      publicId: AUTO,
      kid: "signing-1",
    });
  });

  it("hands back the jti, because the one-shot rule is the app's to keep", async () => {
    // This module cannot enforce it: replay protection needs storage with a
    // lifetime, and that belongs to whoever is verifying.
    const { jwks } = published({ [AUTO]: [delegates[AUTO].jwk] });
    expect((await verify(token(), jwks)).jti).toBe("one-shot-1");
  });

  it("reads the delegate's name case-insensitively", async () => {
    const { jwks } = published({ [AUTO]: [delegates[AUTO].jwk] });
    expect((await verify(token(), jwks, { delegate: "MoreliTea.Auto" })).signer.publicId).toBe(
      AUTO
    );
  });
});

describe("who signed", () => {
  it("fetches the document the caller named, and no other", async () => {
    const { fetchImpl, jwks } = published({ [AUTO]: [delegates[AUTO].jwk] });
    await verify(token(), jwks);
    expect(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toBe(
      `${BASE}${delegateJwksPath(AUTO)}`
    );
  });

  it("refuses a token signed by a delegate other than the one named", async () => {
    // Naming a delegate you are not fetches a key set you cannot sign for.
    const { jwks } = published({
      [AUTO]: [delegates[AUTO].jwk],
      [OTHER]: [delegates[OTHER].jwk],
    });
    await expect(verify(token({}, { signAs: OTHER }), jwks)).rejects.toThrow(
      /signature did not verify/
    );
  });

  it("keeps two delegates apart when they publish the same kid", async () => {
    // The property the per-delegate document exists for. A merged set keyed by
    // `kid` alone would resolve one of these labels to the other's key, and
    // which one lost would depend on ordering neither side controls.
    const moduli = [delegates[AUTO].jwk.n, delegates[OTHER].jwk.n];
    expect(moduli[0]).not.toBe(moduli[1]); // a real collision, not one key twice
    expect(delegates[AUTO].jwk.kid).toBe(delegates[OTHER].jwk.kid);

    const { jwks } = published({
      [AUTO]: [delegates[AUTO].jwk],
      [OTHER]: [delegates[OTHER].jwk],
    });

    const fromAuto = await verify(token({}, { signAs: AUTO }), jwks);
    const fromOther = await verify(token({}, { signAs: OTHER }), jwks, { delegate: OTHER });

    expect(fromAuto.signer.publicId).toBe(AUTO);
    expect(fromOther.signer.publicId).toBe(OTHER);
    expect(fromAuto.signer.kid).toBe(fromOther.signer.kid);
  });

  it("refuses a caller that named no delegate, or named nonsense", async () => {
    // The value becomes a path segment, so it is checked before it is used.
    const { fetchImpl, jwks } = published({ [AUTO]: [delegates[AUTO].jwk] });
    for (const delegate of ["", "   ", "nodot", "../../etc/passwd", "a b.c"]) {
      await expect(verify(token(), jwks, { delegate })).rejects.toThrow(/named no delegate/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads the header the caller names itself in", () => {
    expect(delegateHeader({ [DELEGATE_HEADER]: AUTO })).toBe(AUTO);
    expect(delegateHeader({ [DELEGATE_HEADER.toLowerCase()]: ` ${AUTO} ` })).toBe(AUTO);
    expect(delegateHeader({})).toBeNull();
    expect(delegateHeader({ [DELEGATE_HEADER]: "  " })).toBeNull();
  });
});

describe("what it refuses", () => {
  const set = () => published({ [AUTO]: [delegates[AUTO].jwk] });

  it("a token addressed to somewhere other than this app", async () => {
    // The separation this module exists for: Initiative and an app are two
    // audiences, and one's token does not verify at the other.
    const { jwks } = set();
    await expect(verify(token({ aud: "initiative:auto-delegation" }), jwks)).rejects.toThrow(
      /not initiative-app:morelitea\.github/
    );
  });

  it("a token addressed to a different app", async () => {
    const { jwks } = set();
    await expect(verify(token({ aud: audienceFor("other.app") }), jwks)).rejects.toThrow(
      DelegationTokenError
    );
  });

  it("an audience array that does not include this app", async () => {
    const { jwks } = set();
    await expect(
      verify(token({ aud: ["initiative:auto-delegation", audienceFor("other.app")] }), jwks)
    ).rejects.toThrow(DelegationTokenError);
    // And accepts one that does, since an array audience is legal.
    await expect(
      verify(token({ aud: ["other", audienceFor(PUBLIC_ID)] }), jwks)
    ).resolves.toMatchObject({ guildId: 42 });
  });

  it("an algorithm it was not expecting", async () => {
    // Named rather than guessed: an unexpected algorithm is the classic way a
    // token is accepted on terms its issuer never intended.
    const { jwks } = set();
    await expect(verify(token({}, { alg: "none" }), jwks)).rejects.toThrow(
      /unexpected algorithm/
    );
    await expect(verify(token({}, { alg: "HS256" }), jwks)).rejects.toThrow(
      /unexpected algorithm/
    );
  });

  it("a token naming a key that is not in that delegate's set", async () => {
    const { jwks } = set();
    await expect(verify(token({}, { kid: "unknown" }), jwks)).rejects.toThrow(
      DelegationTokenError
    );
  });

  it("a token with no kid at all", async () => {
    const { jwks } = set();
    const header = Buffer.from(JSON.stringify({ alg: "RS256" }), "utf-8").toString("base64url");
    await expect(verify(`${header}.e30.x`, jwks)).rejects.toThrow(/names no key/);
  });

  it("an expired token", async () => {
    const { jwks } = set();
    await expect(verify(token({ exp: Math.floor(NOW / 1000) - 60 }), jwks)).rejects.toThrow(
      /expired/
    );
  });

  it("a token from the future", async () => {
    const { jwks } = set();
    await expect(verify(token({ iat: Math.floor(NOW / 1000) + 600 }), jwks)).rejects.toThrow(
      /not valid yet/
    );
  });

  it("a token that could not be one-shot", async () => {
    const { jwks } = set();
    await expect(verify(token({ jti: undefined }), jwks)).rejects.toThrow(/one-shot/);
  });

  it("a token naming no guild, or naming one that is not a number", async () => {
    const { jwks } = set();
    await expect(verify(token({ guild_id: undefined }), jwks)).rejects.toThrow(/guild_id/);
    await expect(verify(token({ guild_id: "42" }), jwks)).rejects.toThrow(/guild_id/);
  });

  it("something that is not a JWT at all", async () => {
    const { jwks } = set();
    await expect(verify("nonsense", jwks)).rejects.toThrow(/not a JWT/);
    await expect(verify("a.b.c", jwks)).rejects.toThrow(DelegationTokenError);
  });
});

describe("the published document", () => {
  it("is fetched once and reused", async () => {
    const { fetchImpl, jwks } = published({ [AUTO]: [delegates[AUTO].jwk] });
    await verify(token(), jwks);
    await verify(token({ jti: "one-shot-2" }), jwks);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("is cached per delegate, not per deployment", async () => {
    // One cache serves every document. Sharing one *set* across delegates is
    // precisely the merge this design removed.
    const { fetchImpl, jwks } = published({
      [AUTO]: [delegates[AUTO].jwk],
      [OTHER]: [delegates[OTHER].jwk],
    });
    await verify(token({}, { signAs: AUTO }), jwks);
    await verify(token({}, { signAs: OTHER }), jwks, { delegate: OTHER });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not cost a fetch per attempt when the delegate is not one", async () => {
    // The name is caller-supplied, so re-asking on every attempt would let a
    // caller decide how often this app calls the deployment. Two looks per
    // window at most: one to load, one in case a rotation just happened.
    const { fetchImpl, jwks } = published({ [AUTO]: [delegates[AUTO].jwk] });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(verify(token(), jwks, { delegate: "made.up" })).rejects.toThrow(
        /published no keys/
      );
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("says the same thing for every reason a key set is unusable", async () => {
    // "no such delegate", "switched off" and "granted but no key yet" are the
    // deployment's own wiring, not the caller's business.
    const { jwks } = published({ [AUTO]: [] });
    await expect(verify(token(), jwks)).rejects.toThrow(/published no keys/);
    const absent = published({});
    await expect(verify(token(), absent.jwks)).rejects.toThrow(/published no keys/);
  });

  it("reports a fetch that failed as a fetch that failed", async () => {
    // A 503 is transient and not an answer, so it is not cached as one.
    const fetchImpl = vi.fn(async () =>
      new Response("nope", { status: 503 })
    ) as unknown as typeof globalThis.fetch;
    const jwks = new JwksCache({ fetchImpl, now: () => NOW });
    await expect(verify(token(), jwks)).rejects.toThrow(/503/);
    await expect(verify(token(), jwks)).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
