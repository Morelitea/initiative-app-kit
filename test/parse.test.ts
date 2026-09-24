/**
 * The longhand checks, and the inputs a pattern would get wrong.
 */

import { describe, expect, it } from "vitest";

import { isPublicId, stripTrailingSlashes } from "../src/parse.js";

describe("a public id", () => {
  it("takes `<publisher>.<slug>` and deeper", () => {
    expect(isPublicId("acme.tracker")).toBe(true);
    expect(isPublicId("acme.tracker.beta")).toBe(true);
    expect(isPublicId("a1.b2-c_d")).toBe(true);
  });

  it("refuses an empty label", () => {
    for (const value of ["a.", ".a", "a..b", "acme..tracker", "a.b."]) {
      expect(isPublicId(value), value).toBe(false);
    }
  });

  it("insists on at least two labels", () => {
    expect(isPublicId("tracker")).toBe(false);
    expect(isPublicId("")).toBe(false);
  });

  it("refuses a label that does not start with a letter or digit", () => {
    expect(isPublicId("acme.-tracker")).toBe(false);
    expect(isPublicId("_acme.tracker")).toBe(false);
  });

  it("refuses anything outside the alphabet, including a path", () => {
    for (const value of [
      "Acme.tracker",
      "acme.track er",
      "../../etc/passwd",
      "a.b/../c",
      "a.b%2F..%2Fc",
      "acme.tracker\n",
    ]) {
      expect(isPublicId(value), value).toBe(false);
    }
  });

  it("refuses anything that is not a string", () => {
    for (const value of [null, undefined, 42, {}, ["a.b"]]) {
      expect(isPublicId(value)).toBe(false);
    }
  });
});

describe("trailing slashes", () => {
  it("removes every one, and touches nothing else", () => {
    expect(stripTrailingSlashes("https://a.example.com/")).toBe("https://a.example.com");
    expect(stripTrailingSlashes("https://a.example.com///")).toBe("https://a.example.com");
    expect(stripTrailingSlashes("https://a.example.com")).toBe("https://a.example.com");
    expect(stripTrailingSlashes("https://a.example.com/v1/x")).toBe(
      "https://a.example.com/v1/x"
    );
    expect(stripTrailingSlashes("/")).toBe("");
    expect(stripTrailingSlashes("")).toBe("");
  });
});
