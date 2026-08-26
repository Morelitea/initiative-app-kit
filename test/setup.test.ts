/**
 * The switch in front of a one-time registration route.
 *
 * Small surface, and every case here is one where being subtly wrong would not
 * show up as a failure — the gate would simply be open, or a flow would end
 * that nobody meant to end.
 */

import { describe, expect, it } from "vitest";

import { SETUP_STATE_TTL_SECONDS, SetupGate, parseSetupTokens } from "../src/setup.js";

const NOW = 1_700_000_000_000;

describe("reading the tokens an operator set", () => {
  it("takes one", () => {
    expect(parseSetupTokens("just-the-one")).toEqual(["just-the-one"]);
  });

  it("takes several, however they were separated", () => {
    // An operator adding a second is editing a line in a values file and should
    // not have to think about which separator this wants.
    for (const raw of ["a,b,c", "a b c", "a, b, c", "a,\tb\nc", " a , b ,c "]) {
      expect(parseSetupTokens(raw), raw).toEqual(["a", "b", "c"]);
    }
  });

  it("finds nothing in an empty or absent value", () => {
    // The case that matters most: a blank must not become a token that matches
    // the empty string, which would switch the gate on and let everybody
    // through. Every one of these leaves it off.
    for (const raw of ["", "   ", ",", " , , ", null, undefined]) {
      expect(parseSetupTokens(raw)).toEqual([]);
      expect(new SetupGate({ tokens: raw }).enabled).toBe(false);
    }
  });

  it("collapses a token written twice", () => {
    expect(parseSetupTokens("a,a,b")).toEqual(["a", "b"]);
  });
});

describe("whether the routes exist at all", () => {
  it("is off with no token, and answers everything no", () => {
    const gate = new SetupGate();
    expect(gate.enabled).toBe(false);
    expect(gate.authorize("anything")).toBeNull();
    expect(gate.verifyState("anything")).toBe(false);
    // Refuses rather than returning something useless: a state signed with no
    // key would verify against no key.
    expect(() => gate.mintState("anything")).toThrow();
  });

  it("is on the moment one is held", () => {
    expect(new SetupGate({ tokens: "a-token" }).enabled).toBe(true);
  });
});

describe("who is let in", () => {
  const gate = new SetupGate({ tokens: "first-token,second-token" });

  it("hands back which token was presented, not merely a yes", () => {
    // The state minted for the round trip is signed with it, so the answer has
    // to name it.
    expect(gate.authorize("first-token")).toBe("first-token");
    expect(gate.authorize("second-token")).toBe("second-token");
  });

  it("refuses a wrong one, an absent one, and a near miss", () => {
    for (const offered of ["wrong", "", null, undefined, "first-toke", "first-tokenx"]) {
      expect(gate.authorize(offered), String(offered)).toBeNull();
    }
  });
});

describe("the state that carries the authority back", () => {
  const gate = new SetupGate({ tokens: "first-token,second-token" });

  it("verifies what it minted", () => {
    // The vendor returns the operator with a code and this and nothing else, so
    // this is the whole of what the second route can check.
    expect(gate.verifyState(gate.mintState("first-token", NOW), NOW)).toBe(true);
  });

  it("verifies on a replica that did not mint it", () => {
    // The browser leaves from one pod and comes back to whichever the load
    // balancer picks. Nothing is stored, so a second gate holding the same
    // tokens has to reach the same answer.
    const elsewhere = new SetupGate({ tokens: "first-token,second-token" });
    expect(elsewhere.verifyState(gate.mintState("second-token", NOW), NOW)).toBe(true);
  });

  it("expires", () => {
    const state = gate.mintState("first-token", NOW);
    const ttl = SETUP_STATE_TTL_SECONDS * 1000;
    expect(gate.verifyState(state, NOW + ttl - 1_000)).toBe(true);
    expect(gate.verifyState(state, NOW + ttl + 1_000)).toBe(false);
  });

  it("stops verifying when the token that opened it is removed", () => {
    // Removing a token has to end the flows it authorized, or removing it would
    // not be a way of ending them.
    const state = gate.mintState("second-token", NOW);
    const rotated = new SetupGate({ tokens: "first-token" });
    expect(rotated.verifyState(state, NOW)).toBe(false);
  });

  it("leaves the other tokens' flows alone", () => {
    // The reason to hold more than one: replacing a token, or letting a second
    // operator in, must not end somebody else's half-finished flow.
    const state = gate.mintState("first-token", NOW);
    const rotated = new SetupGate({ tokens: "first-token,a-third-token" });
    expect(rotated.verifyState(state, NOW)).toBe(true);
  });

  it("will not mint under a token it does not hold", () => {
    expect(() => gate.mintState("not-held", NOW)).toThrow();
  });

  it("refuses anything that is not a state it would have produced", () => {
    for (const state of [
      null,
      undefined,
      "",
      "nonsense",
      "one.two",
      "one.two.three.four",
      // A well-shaped state with a signature that is not one.
      `${Math.floor(NOW / 1000) + 60}.abc.not-a-signature`,
      // A non-numeric expiry, which `Number()` would happily turn into NaN and
      // a `<` comparison would then answer false to.
      "later.abc.sig",
    ]) {
      expect(gate.verifyState(state, NOW), String(state)).toBe(false);
    }
  });

  it("does not repeat a state", () => {
    // The nonce is what stops two flows opened in the same second sharing one.
    expect(gate.mintState("first-token", NOW)).not.toBe(gate.mintState("first-token", NOW));
  });
});
