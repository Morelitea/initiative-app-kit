/**
 * Who may register an app that has not registered yet.
 *
 * An app in this state is the one thing it should never be by accident: running
 * with no credentials and a route that mints some. The window is opened by the
 * operator and by nobody else, and these pin the two ways that goes wrong —
 * treating an absent token as an empty one, and comparing in a way that leaks.
 */

import { describe, expect, it } from "vitest";

import {
  SETUP_TOKEN_ENV,
  permitsSetup,
  setupToken,
  signSetupState,
  verifySetupState,
} from "../src/setup.js";

const OPEN = { [SETUP_TOKEN_ENV]: "s3cr3t-token" };
const SHUT = {};

describe("the setup window", () => {
  it("is shut when the deployment named no token", () => {
    // The resting state, and the one an app is in for the whole of its life
    // after the first minute. An absent token is not an empty one: read as
    // empty, an operator who forgot the variable would be offering
    // registration to whoever asked.
    expect(setupToken(SHUT)).toBeNull();
    expect(permitsSetup("", SHUT)).toBe(false);
    expect(permitsSetup("anything", SHUT)).toBe(false);
    expect(permitsSetup(undefined, SHUT)).toBe(false);
  });

  it("is shut for a token that is only whitespace", () => {
    expect(setupToken({ [SETUP_TOKEN_ENV]: "   " })).toBeNull();
    expect(permitsSetup("   ", { [SETUP_TOKEN_ENV]: "   " })).toBe(false);
  });

  it("opens for the token, and for nothing near it", () => {
    expect(permitsSetup("s3cr3t-token", OPEN)).toBe(true);
    expect(permitsSetup("s3cr3t-toke", OPEN)).toBe(false);
    expect(permitsSetup("s3cr3t-tokenn", OPEN)).toBe(false);
    expect(permitsSetup("S3CR3T-TOKEN", OPEN)).toBe(false);
    expect(permitsSetup(null, OPEN)).toBe(false);
    expect(permitsSetup(7, OPEN)).toBe(false);
  });
});

describe("the state a round trip carries", () => {
  it("comes back recognised, and cannot be minted without the token", () => {
    const state = "01234567-89ab-cdef-0123-456789abcdef";
    const signed = signSetupState(state, OPEN)!;

    expect(verifySetupState(state, signed, OPEN)).toBe(true);
    // A different trip, and somebody else's token.
    expect(verifySetupState("another-state", signed, OPEN)).toBe(false);
    expect(verifySetupState(state, signed, { [SETUP_TOKEN_ENV]: "other" })).toBe(false);
  });

  it("signs nothing when the window is shut", () => {
    expect(signSetupState("x", SHUT)).toBeNull();
    expect(verifySetupState("x", "anything", SHUT)).toBe(false);
  });

  it("refuses a signature that is not one", () => {
    const signed = signSetupState("x", OPEN)!;
    expect(verifySetupState("x", undefined, OPEN)).toBe(false);
    expect(verifySetupState("x", signed.slice(0, -1), OPEN)).toBe(false);
  });
});
