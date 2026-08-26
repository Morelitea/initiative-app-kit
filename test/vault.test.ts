/**
 * Sealing credentials, and the ways this construction breaks quietly.
 *
 * Every case here is one an app could get wrong without any test failing and
 * without any error being logged — which is the argument for the code living in
 * one place instead of being rewritten per app.
 */

import { describe, expect, it } from "vitest";

import { createVault } from "../src/vault.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER = Buffer.alloc(32, 9).toString("base64");

describe("what it seals", () => {
  it("comes back out", () => {
    const vault = createVault(KEY);
    expect(vault.open(vault.seal("ghu_member"))).toBe("ghu_member");
  });

  it("does not contain what went in", () => {
    const vault = createVault(KEY);
    expect(vault.seal("ghu_member")).not.toContain("ghu_member");
  });

  it("survives a round trip through non-ASCII", () => {
    // Sealed as UTF-8 and read back as UTF-8. A vendor label is a place this
    // shows up, and a mangled one is only noticed by whoever it belongs to.
    const vault = createVault(KEY);
    expect(vault.open(vault.seal("@zoë–münchen"))).toBe("@zoë–münchen");
  });
});

describe("the nonce", () => {
  it("is fresh per value, which is the whole of GCM's safety", () => {
    // Reusing a nonce under GCM leaks the keystream and forges tags. Nothing
    // observable goes wrong when an app gets this wrong, so it is asserted.
    const vault = createVault(KEY);
    const sealed = new Set(Array.from({ length: 50 }, () => vault.seal("same")));
    expect(sealed.size).toBe(50);
  });
});

describe("what it refuses to open", () => {
  it("a value sealed under a different key", () => {
    const sealed = createVault(OTHER).seal("ghu_member");
    expect(createVault(KEY).open(sealed)).toBeNull();
  });

  it("a ciphertext somebody edited", () => {
    // Authenticated encryption: this fails to open rather than decrypting into
    // something the editor chose.
    const vault = createVault(KEY);
    const [nonce, body, tag] = vault.seal("ghu_member").split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 0xff;
    expect(vault.open([nonce, flipped.toString("base64url"), tag].join("."))).toBeNull();
  });

  it("a tag somebody edited", () => {
    const vault = createVault(KEY);
    const [nonce, body, tag] = vault.seal("ghu_member").split(".");
    const flipped = Buffer.from(tag, "base64url");
    flipped[0] ^= 0xff;
    expect(vault.open([nonce, body, flipped.toString("base64url")].join("."))).toBeNull();
  });

  it("anything that is not the shape it writes", () => {
    const vault = createVault(KEY);
    for (const junk of ["", "plaintext", "a.b", "a.b.c.d", "...", "a.b.c"]) {
      expect(vault.open(junk)).toBeNull();
    }
  });
});

describe("the key", () => {
  it("is checked at construction, not at first use", () => {
    // So a deployment with a truncated key dies at boot beside everything else
    // that starts, rather than the first time a member connects.
    for (const bad of ["", "c2hvcnQ=", Buffer.alloc(16, 1).toString("base64")]) {
      expect(() => createVault(bad)).toThrow(/32 bytes/);
    }
  });
});
