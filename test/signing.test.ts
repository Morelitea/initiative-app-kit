/**
 * The kit signs what the platform verifies.
 *
 * The vectors in `vectors.json` were produced by the platform's own
 * implementation, not by a second reading of the spec — which is the only way
 * this test can fail for the right reason. A change on either side that breaks
 * agreement breaks here.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  APP_HEADER,
  NONCE_HEADER,
  SIGNATURE_HEADER,
  SIGNATURE_WINDOW_SECONDS,
  TIMESTAMP_HEADER,
  answerChallenge,
  mintNonce,
  signRequest,
  signedHeaders,
  signingMaterial,
  verifyRequest,
} from "../src/signing.js";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, "vectors.json"), "utf-8")) as {
  secret: string;
  requests: Array<{
    method: string;
    path: string;
    query: string;
    timestamp: string;
    nonce: string;
    body: string;
    material: string;
    signature: string;
  }>;
  handshake: { challenge: string; response: string };
};

const bytes = (value: string) => new TextEncoder().encode(value);

describe("agreement with the platform", () => {
  it.each(vectors.requests)("signs $method $path as the platform does", (vector) => {
    const input = {
      method: vector.method,
      path: vector.path,
      query: vector.query,
      timestamp: vector.timestamp,
      nonce: vector.nonce,
      body: bytes(vector.body),
    };
    expect(signingMaterial(input).toString("utf-8")).toBe(vector.material);
    expect(signRequest(vectors.secret, input)).toBe(vector.signature);
  });

  it("answers a handshake challenge as the platform expects", () => {
    expect(answerChallenge(vectors.secret, vectors.handshake.challenge)).toBe(
      vectors.handshake.response
    );
  });
});

describe("signedHeaders", () => {
  it("produces headers its own verifier accepts", () => {
    const body = bytes('{"hello":"world"}');
    const headers = signedHeaders({
      publicId: "acme.tracker",
      secret: vectors.secret,
      method: "POST",
      path: "/api/v1/app-channel/events",
      query: "",
      body,
    });
    expect(headers[APP_HEADER]).toBe("acme.tracker");
    expect(headers[SIGNATURE_HEADER]).toMatch(/^sha256=[0-9a-f]{64}$/);

    const result = verifyRequest({
      secret: vectors.secret,
      method: "POST",
      path: "/api/v1/app-channel/events",
      query: "",
      body,
      headers,
    });
    expect(result).toMatchObject({ ok: true, publicId: "acme.tracker" });
  });

  it("round-trips a request that carries a query", () => {
    const path = "/api/v1/app-service/installs/7/connections/resolve";
    const query = "delegate=acme.auto&subject=abc";
    const headers = signedHeaders({
      publicId: "acme.tracker",
      secret: vectors.secret,
      method: "GET",
      path,
      query,
      body: new Uint8Array(),
    });

    const base = {
      secret: vectors.secret,
      method: "GET",
      path,
      body: new Uint8Array(),
      headers,
    };
    expect(verifyRequest({ ...base, query })).toMatchObject({ ok: true });
    // Same signature, a different question: the parameters are inside the MAC.
    expect(verifyRequest({ ...base, query: "delegate=acme.auto&subject=xyz" })).toEqual(
      { ok: false, reason: "bad_signature" }
    );
    // ...as is their order, which neither side canonicalizes.
    expect(
      verifyRequest({ ...base, query: "subject=abc&delegate=acme.auto" })
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("mints a fresh nonce each time", () => {
    // The platform spends a nonce once, so a caller reusing one is refused on
    // its second call however correct the signature is.
    const seen = new Set(Array.from({ length: 50 }, () => mintNonce()));
    expect(seen.size).toBe(50);
  });
});

describe("verifyRequest", () => {
  const body = bytes("{}");
  const base = {
    secret: vectors.secret,
    method: "POST",
    path: "/hook",
    query: "",
    body,
  };
  const headersFor = (overrides: Record<string, string> = {}) => ({
    ...signedHeaders({ publicId: "acme.tracker", ...base }),
    ...overrides,
  });

  it("refuses a missing signature", () => {
    const headers = headersFor();
    delete (headers as Record<string, unknown>)[SIGNATURE_HEADER];
    expect(verifyRequest({ ...base, headers })).toEqual({
      ok: false,
      reason: "missing_signature",
    });
  });

  it("refuses a body that changed after signing", () => {
    const headers = headersFor();
    expect(
      verifyRequest({ ...base, body: bytes('{"tampered":true}'), headers })
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a path that changed after signing", () => {
    const headers = headersFor();
    expect(verifyRequest({ ...base, path: "/elsewhere", headers })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses a query that changed after signing", () => {
    const headers = headersFor();
    expect(verifyRequest({ ...base, query: "added=later", headers })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses a timestamp outside the window", () => {
    const headers = headersFor({
      [TIMESTAMP_HEADER]: String(Math.floor(Date.now() / 1000) - SIGNATURE_WINDOW_SECONDS - 60),
    });
    expect(verifyRequest({ ...base, headers })).toEqual({
      ok: false,
      reason: "stale_timestamp",
    });
  });

  it("refuses an over-long nonce without checking the signature", () => {
    const headers = headersFor({ [NONCE_HEADER]: "a".repeat(65) });
    expect(verifyRequest({ ...base, headers })).toEqual({
      ok: false,
      reason: "missing_signature",
    });
  });

  it("reads headers whatever their case", () => {
    // Most servers hand them over lower-cased.
    const signed = signedHeaders({ publicId: "acme.tracker", ...base });
    const lowered = Object.fromEntries(
      Object.entries(signed).map(([key, value]) => [key.toLowerCase(), value])
    );
    expect(verifyRequest({ ...base, headers: lowered })).toMatchObject({ ok: true });
  });

  it("returns the nonce for the caller to spend", () => {
    // Replay protection needs storage with a lifetime, which belongs to the app
    // — so the kit surfaces the value rather than pretending to remember it.
    const headers = headersFor();
    const result = verifyRequest({ ...base, headers });
    expect(result.ok && result.nonce).toBe(headers[NONCE_HEADER]);
  });
});
