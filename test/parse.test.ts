/**
 * The checks that replaced patterns, and the inputs the patterns got wrong.
 *
 * Most of these cases exist because they *passed* before. That is the argument
 * for writing the checks out longhand rather than the argument for testing
 * them: a character class says nothing about an empty label, an unanchored
 * suffix matches in the middle, and a dotted-quad matcher sees only one of the
 * four ways to write a loopback address. None of that is visible in a pattern
 * by reading it, and all of it is a specific failing assertion here.
 */

import { describe, expect, it } from "vitest";

import { isDigits, isPublicId, stripTrailingSlashes } from "../src/parse.js";
import { isPublicTarget } from "../src/events.js";

describe("a public id", () => {
  it("takes `<publisher>.<slug>` and deeper", () => {
    expect(isPublicId("morelitea.github")).toBe(true);
    expect(isPublicId("morelitea.auto")).toBe(true);
    expect(isPublicId("acme.tracker.beta")).toBe(true);
    expect(isPublicId("a1.b2-c_d")).toBe(true);
  });

  it("refuses an empty label, which the pattern it replaced accepted", () => {
    // `^[a-z0-9_-]+\\.[a-z0-9._-]+$` matched every one of these, because a
    // character class permitting `.` cannot say that a label is non-empty. Each
    // becomes a different path segment from the one it appears to be.
    for (const value of ["a.", ".a", "a..b", "morelitea..github", "a.b."]) {
      expect(isPublicId(value), value).toBe(false);
    }
  });

  it("insists on at least two labels", () => {
    expect(isPublicId("github")).toBe(false);
    expect(isPublicId("")).toBe(false);
  });

  it("refuses a label that does not start with a letter or digit", () => {
    expect(isPublicId("morelitea.-github")).toBe(false);
    expect(isPublicId("_morelitea.github")).toBe(false);
  });

  it("refuses anything outside the alphabet, including a path", () => {
    // The reason this check exists at all: the value becomes a path segment in
    // the URL that fetches a delegate's key set.
    for (const value of [
      "MoreliTea.github",
      "morelitea.git hub",
      "../../etc/passwd",
      "a.b/../c",
      "a.b%2F..%2Fc",
      "morelitea.github\n",
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

describe("digits", () => {
  it("takes decimal digits and nothing else", () => {
    expect(isDigits("0")).toBe(true);
    expect(isDigits("100")).toBe(true);
    expect(isDigits("")).toBe(false);
    // Each of these is something `Number()` would happily accept.
    for (const value of ["1.5", "-1", "+1", " 1", "1 ", "0x10", "1e3", "١٢٣"]) {
      expect(isDigits(value), value).toBe(false);
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

describe("addresses that are not the public internet", () => {
  const allowed = (url: string) => isPublicTarget(new URL(url));

  it("refuses loopback however it is written", () => {
    // The case a dotted-quad pattern misses entirely. All four reach 127.0.0.1
    // at a resolver, and only the first looks like an IP address to a pattern.
    for (const host of ["127.0.0.1", "127.1", "0177.0.0.1", "2130706433"]) {
      expect(allowed(`http://${host}/in`), host).toBe(false);
    }
  });

  it("refuses an IPv4-mapped IPv6 address", () => {
    // `::ffff:127.0.0.1` is a loopback address wearing v6 notation, and a v6
    // prefix check alone says nothing about it.
    for (const host of ["[::ffff:127.0.0.1]", "[::ffff:169.254.169.254]", "[::ffff:10.0.0.1]"]) {
      expect(allowed(`http://${host}/in`), host).toBe(false);
    }
  });

  it("refuses the cloud metadata address specifically", () => {
    expect(allowed("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("refuses every private v4 range", () => {
    for (const host of [
      "0.0.0.0",
      "10.0.0.5",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.4.1",
      "172.31.255.254",
      "192.168.1.9",
    ]) {
      expect(allowed(`http://${host}/in`), host).toBe(false);
    }
  });

  it("still takes the public v4 addresses next to those ranges", () => {
    // The boundaries a range check gets right and a prefix match does not:
    // 172.15 and 172.32 are public, and only 172.16–172.31 is not.
    for (const host of ["172.15.0.1", "172.32.0.1", "9.9.9.9", "100.63.0.1", "100.128.0.1"]) {
      expect(allowed(`http://${host}/in`), host).toBe(true);
    }
  });

  it("refuses reserved v6, and takes the rest", () => {
    for (const host of ["[::1]", "[::]", "[fd00::1]", "[fe80::1]", "[fc00::1]"]) {
      expect(allowed(`http://${host}/in`), host).toBe(false);
    }
    expect(allowed("http://[2606:4700:4700::1111]/in")).toBe(true);
  });

  it("refuses reserved names, and only at the end", () => {
    for (const host of ["localhost", "auto.localhost", "svc.local", "queue.internal"]) {
      expect(allowed(`http://${host}/in`), host).toBe(false);
    }
    // The bug an unanchored suffix pattern has: this is an ordinary public
    // hostname that merely contains one of the reserved words.
    for (const host of ["localhost.example.com", "internal.example.com", "not-localhost.com"]) {
      expect(allowed(`http://${host}/in`), host).toBe(true);
    }
  });

  it("refuses a scheme that is not http, and credentials in the target", () => {
    expect(allowed("file:///etc/passwd")).toBe(false);
    expect(allowed("gopher://example.com/")).toBe(false);
    expect(allowed("https://user:pass@auto.example.com/in")).toBe(false);
  });

  it("takes an ordinary public address", () => {
    expect(allowed("https://auto.example.com/hooks")).toBe(true);
    expect(allowed("http://auto.example.com:9000/hooks")).toBe(true);
  });
});
