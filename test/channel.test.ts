/**
 * What a signed outbound call has to get right, stated as properties.
 *
 * Every one of these fails the same way in production — a 401 with nothing on
 * either side saying which half was wrong — so each is asserted against the
 * kit's own verifier rather than against a hand-written expectation. If the
 * bytes sent and the bytes signed ever part company, `verifyRequest` is what
 * notices, and it is the same code the platform runs.
 */

import { describe, expect, it } from "vitest";

import {
  CHANNEL_BASE,
  ChannelError,
  InitiativeChannel,
} from "../src/channel.js";
import { verifyRequest } from "../src/signing.js";

const SECRET = "a-registration-secret";
const PUBLIC_ID = "acme.tracker";

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** A fetch that records the call and answers whatever the test wants. */
function recorder(answer: { status?: number; body?: unknown } = {}) {
  const calls: Seen[] = [];
  const doFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body;
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body:
        raw === undefined || raw === null
          ? new Uint8Array()
          : (raw as Uint8Array),
    });
    const status = answer.status ?? 200;
    return new Response(JSON.stringify(answer.body ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { calls, doFetch };
}

function channel(doFetch: typeof globalThis.fetch, baseUrl = "https://initiative.internal") {
  return new InitiativeChannel({
    publicId: PUBLIC_ID,
    secret: SECRET,
    baseUrl,
    fetch: doFetch,
  });
}

/** The check the platform makes, run against what the client actually sent. */
function verifyAsThePlatformWould(seen: Seen) {
  return verifyRequest({
    secret: SECRET,
    method: seen.method,
    path: new URL(seen.url).pathname,
    body: seen.body,
    headers: seen.headers,
  });
}

describe("what the platform will verify", () => {
  it("signs the path it sends, on a route carrying an id", async () => {
    const { calls, doFetch } = recorder({ body: { items: [] } });
    await channel(doFetch).connections(42);

    expect(calls[0].url).toBe(
      `https://initiative.internal${CHANNEL_BASE}/installs/42/connections`
    );
    expect(verifyAsThePlatformWould(calls[0])).toEqual({
      ok: true,
      publicId: PUBLIC_ID,
      nonce: expect.any(String),
    });
  });

  it("signs the bytes it sends, not a second serialization of them", async () => {
    const { calls, doFetch } = recorder({ body: {} });
    await channel(doFetch).writeConnection(7, "ref-abc", {
      values: {
        // Key order and unicode both survive only if one string is used twice.
        z: "last",
        a: "first",
        note: "café ☕",
      },
    });

    const seen = calls[0];
    expect(verifyAsThePlatformWould(seen).ok).toBe(true);
    expect(JSON.parse(Buffer.from(seen.body).toString("utf-8"))).toEqual({
      values: { z: "last", a: "first", note: "café ☕" },
    });
  });

  it("keeps the signed path stable when the base URL has a trailing slash", async () => {
    const { calls, doFetch } = recorder({ body: { items: [] } });
    await channel(doFetch, "https://initiative.internal/").installs();

    expect(calls[0].url).toBe(`https://initiative.internal${CHANNEL_BASE}/installs`);
    expect(verifyAsThePlatformWould(calls[0]).ok).toBe(true);
  });

  it("signs an empty body on a read", async () => {
    const { calls, doFetch } = recorder({ body: { items: [] } });
    await channel(doFetch).installs();

    expect(calls[0].body).toEqual(new Uint8Array());
    expect(calls[0].headers["Content-Type"]).toBeUndefined();
    expect(verifyAsThePlatformWould(calls[0]).ok).toBe(true);
  });

  it("escapes a reference into the path it signed", async () => {
    const { calls, doFetch } = recorder({ body: {} });
    // The platform mints these from a URL-safe alphabet; the point is that
    // whatever arrives, one spelling is both sent and signed.
    await channel(doFetch).writeConnection(3, "ref/with slash", {
      status: "connected",
    });

    expect(new URL(calls[0].url).pathname).toBe(
      `${CHANNEL_BASE}/installs/3/connections/ref%2Fwith%20slash`
    );
    expect(verifyAsThePlatformWould(calls[0]).ok).toBe(true);
  });
});

describe("what it returns", () => {
  it("unwraps a list response to its items", async () => {
    const { doFetch } = recorder({
      body: { items: [{ install_id: 1, guild_id: 9 }] },
    });
    const installs = await channel(doFetch).installs();
    expect(installs).toEqual([{ install_id: 1, guild_id: 9 }]);
  });

  it("carries the platform's own refusal code out", async () => {
    const { doFetch } = recorder({ status: 409, body: { detail: "APP_DISABLED" } });

    await expect(channel(doFetch).config(4)).rejects.toMatchObject({
      status: 409,
      detail: "APP_DISABLED",
    });
    await expect(channel(doFetch).config(4)).rejects.toBeInstanceOf(ChannelError);
  });

  it("still reports a refusal that arrived as something other than JSON", async () => {
    // A proxy in front of the platform answering HTML: the status is all there
    // is, and the caller must still get an error rather than a parse failure.
    const doFetch = (async () =>
      new Response("<html>502</html>", {
        status: 502,
        statusText: "Bad Gateway",
      })) as unknown as typeof globalThis.fetch;

    await expect(channel(doFetch).installs()).rejects.toMatchObject({
      status: 502,
      detail: "Bad Gateway",
    });
  });
});
