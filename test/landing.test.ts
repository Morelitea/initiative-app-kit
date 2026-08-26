/**
 * Handing a member back to Initiative, and refusing to hand them anywhere else.
 *
 * The return address rides in the query string, so the browser carries it and
 * anyone can propose one. Everything here is about the difference between an
 * address Initiative wrote and an address somebody typed — because an app that
 * followed the second would be a redirector on a hostname people trust.
 */

import { describe, expect, it } from "vitest";

import {
  OUTCOME_PARAM,
  RETURN_SIGNATURE_PARAM,
  RETURN_URL_PARAM,
  landingUrl,
  returnAddress,
  signReturnUrl,
} from "../src/landing.js";

const SECRET = "the-registration-secret";
const HOME = "https://initiative.example/guilds/7/apps/github/connected";

/** A connect URL's query, as Initiative builds it. */
function handoff(returnUrl: string, secret = SECRET): URLSearchParams {
  return new URLSearchParams({
    connection_ref: "ref-abc",
    guild_id: "7",
    [RETURN_URL_PARAM]: returnUrl,
    [RETURN_SIGNATURE_PARAM]: signReturnUrl(secret, returnUrl),
  });
}

describe("an address Initiative wrote", () => {
  it("comes back", () => {
    expect(returnAddress({ secret: SECRET, params: handoff(HOME) })).toBe(HOME);
  });

  it("survives the other parameters travelling with it", () => {
    // The signature is over the address alone, so the rest of the handoff can
    // grow a field without every app's verification breaking.
    const params = handoff(HOME);
    params.set("something_new", "later");
    expect(returnAddress({ secret: SECRET, params })).toBe(HOME);
  });
});

describe("an address it did not", () => {
  it("is refused when the signature is for a different address", () => {
    // The attack this exists for: a real signature lifted from a real connect
    // URL, pasted beside somewhere else.
    const params = handoff(HOME);
    params.set(RETURN_URL_PARAM, "https://evil.example/looks-official");
    expect(returnAddress({ secret: SECRET, params })).toBeNull();
  });

  it("is refused when it was signed with a different secret", () => {
    const params = handoff("https://evil.example/looks-official", "some-other-secret");
    expect(returnAddress({ secret: SECRET, params })).toBeNull();
  });

  it("is refused when it is unsigned", () => {
    const params = new URLSearchParams({ [RETURN_URL_PARAM]: HOME });
    expect(returnAddress({ secret: SECRET, params })).toBeNull();
  });

  it("is absent when Initiative sent none", () => {
    // The ordinary case, not a failure: somebody who arrived by a hand-copied
    // link has no return address, and the app says its piece on its own page.
    const params = new URLSearchParams({ connection_ref: "ref-abc", guild_id: "7" });
    expect(returnAddress({ secret: SECRET, params })).toBeNull();
  });
});

describe("what counts as a place to send a browser", () => {
  it("refuses a scheme that is not a place at all", () => {
    // Signed by Initiative and still refused. A signature says who wrote the
    // address, not that following it is a thing to do.
    for (const scheme of ["javascript:alert(1)", "data:text/html,<h1>hi", "file:///etc"]) {
      expect(returnAddress({ secret: SECRET, params: handoff(scheme) })).toBeNull();
    }
  });

  it("refuses plaintext http off the loopback", () => {
    expect(
      returnAddress({ secret: SECRET, params: handoff("http://initiative.example/x") })
    ).toBeNull();
  });

  it("takes plaintext http on the loopback, so a laptop works", () => {
    const local = "http://localhost:5173/guilds/7/apps/github/connected";
    expect(returnAddress({ secret: SECRET, params: handoff(local) })).toBe(local);
  });
});

describe("the outcome that goes back with them", () => {
  it("is one word appended to whatever the address already carried", () => {
    const landing = new URL(landingUrl(`${HOME}?app=morelitea.github`, "connected"));
    expect(landing.searchParams.get("app")).toBe("morelitea.github");
    expect(landing.searchParams.get(OUTCOME_PARAM)).toBe("connected");
  });

  it("replaces one already there rather than adding a second", () => {
    // A member who connects twice must not land on `?outcome=expired&outcome=connected`,
    // where which one is read depends on the framework.
    const landing = new URL(landingUrl(`${HOME}?outcome=expired`, "connected"));
    expect(landing.searchParams.getAll(OUTCOME_PARAM)).toEqual(["connected"]);
  });
});
