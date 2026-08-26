/**
 * Binding an authorization code to the server that asked for it.
 *
 * The mistakes this guards against all produce a flow that works: the member
 * connects, the token arrives, and the code was never actually bound to
 * anything. They are asserted because nothing else would notice.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CHALLENGE_METHOD, challengeFor, mintPkce } from "../src/pkce.js";

describe("the verifier", () => {
  it("is fresh every time", () => {
    const minted = new Set(Array.from({ length: 50 }, () => mintPkce().verifier));
    expect(minted.size).toBe(50);
  });

  it("is long enough to be worth having", () => {
    // The spec's floor is 43 characters. Shorter is a secret somebody can
    // search for, which is the same as no PKCE at all.
    const { verifier } = mintPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("is base64url, so it survives a query string unencoded", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(mintPkce().verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("the challenge", () => {
  it("is the base64url SHA-256 of the verifier's characters", () => {
    // Over the string, not over the bytes it decodes to. Getting that backwards
    // gives a challenge the vendor rejects at exchange time and not before.
    const { verifier, challenge } = mintPkce();
    expect(challenge).toBe(
      createHash("sha256").update(verifier, "ascii").digest("base64url")
    );
  });

  it("is unpadded base64url, not base64", () => {
    // `+`, `/` and `=` all mean something else in a query string, and a vendor
    // comparing strings does not normalize.
    for (let i = 0; i < 50; i += 1) {
      expect(mintPkce().challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("is not the verifier", () => {
    // The one thing that must be true: what goes on the wire cannot be used to
    // exchange the code.
    const { verifier, challenge } = mintPkce();
    expect(challenge).not.toBe(verifier);
  });

  it("is derived, so a stored verifier still checks out", () => {
    const { verifier, challenge } = mintPkce();
    expect(challengeFor(verifier)).toBe(challenge);
  });

  it("names the method the vendor is told", () => {
    expect(CHALLENGE_METHOD).toBe("S256");
  });
});
