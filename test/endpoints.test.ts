/**
 * Calling an app's declared endpoints.
 *
 * The surface is small on purpose, and the thing worth testing is that it stays
 * small: a caller picks from a closed set an app author wrote, and never
 * describes a request the app then performs. Everything below is about that
 * boundary holding, plus the one property that keeps a delegated call honest —
 * the actor is always reported.
 */

import { describe, expect, it, vi } from "vitest";

import { CHANNEL_BASE, InitiativeChannel } from "../src/channel.js";
import { ENDPOINTS_PATH, parseInvoke } from "../src/endpoints.js";
import type { Endpoint } from "../src/manifest.js";

const PUBLIC_ID = "acme.tracker";

const DECLARED: Endpoint[] = [
  {
    id: "app.acme.tracker.ticket-open",
    direction: "write",
    actors: ["member", "installation"],
    params: [
      { key: "project", type: "string", label: { en: "Project" } },
      { key: "title", type: "string", label: { en: "Title" } },
    ],
  },
  {
    id: "app.acme.tracker.open-tickets",
    direction: "read",
    actors: ["member"],
    params: [{ key: "project", type: "string", label: { en: "Project" } }],
  },
  { id: "app.acme.tracker.ticket-opened", direction: "emit" },
];

describe("calling one", () => {
  const parse = (body: unknown) => parseInvoke(body, DECLARED);

  it("takes a well-formed request", () => {
    expect(
      parse({
        endpoint: "app.acme.tracker.ticket-open",
        guild_id: 42,
        params: { project: "widgets", title: "It broke" },
      })
    ).toEqual({
      ok: true,
      request: {
        endpoint: "app.acme.tracker.ticket-open",
        guild_id: 42,
        params: { project: "widgets", title: "It broke" },
      },
    });
  });

  it("takes a read on the same path as a write", () => {
    // The whole point of one vocabulary: a widget's fetch and an automation's
    // write are the same call, and only the token differs.
    expect(
      parse({
        endpoint: "app.acme.tracker.open-tickets",
        guild_id: 42,
        params: { project: "widgets" },
      }).ok
    ).toBe(true);
  });

  it("refuses anything the app did not declare", () => {
    // The closed set is most of what makes this safe to expose: a caller
    // chooses among things the app author wrote, and cannot describe a request
    // the app then performs.
    expect(parse({ endpoint: "app.acme.tracker.rm-rf", guild_id: 42, params: {} })).toEqual({
      ok: false,
      error: "this app does not offer 'app.acme.tracker.rm-rf'",
    });
    // Including another app's endpoint, which is why namespacing matters.
    expect(parse({ endpoint: "app.other.app.ticket-open", guild_id: 42, params: {} }).ok).toBe(
      false
    );
  });

  it("refuses an emit, which travels the other way", () => {
    // There is nothing to call: the app posts these to whoever subscribed, so a
    // caller that means to hear about them wants a subscription instead. Saying
    // which is the difference between a wrong turn and a dead end.
    expect(
      parse({ endpoint: "app.acme.tracker.ticket-opened", guild_id: 42, params: {} })
    ).toEqual({
      ok: false,
      error:
        "'app.acme.tracker.ticket-opened' is emitted rather than called — subscribe to it instead",
    });
  });

  it("treats missing params as no params rather than refusing", () => {
    const result = parse({ endpoint: "app.acme.tracker.ticket-open", guild_id: 42 });
    expect(result.ok && result.request.params).toEqual({});
  });

  it("insists on the fields it routes on", () => {
    expect(parse(null).ok).toBe(false);
    expect(parse("a string").ok).toBe(false);
    expect(parse({ guild_id: 42 }).ok).toBe(false);
    expect(parse({ endpoint: DECLARED[0].id }).ok).toBe(false);
    expect(parse({ endpoint: DECLARED[0].id, guild_id: "42" }).ok).toBe(false);
    // An array is an object to `typeof`, and would index as one.
    expect(parse({ endpoint: DECLARED[0].id, guild_id: 42, params: [] }).ok).toBe(false);
  });

  it("puts discovery and invocation on one path", () => {
    expect(ENDPOINTS_PATH).toBe("/v1/endpoints");
  });
});

describe("resolving who a delegated call is for", () => {
  function channel(doFetch: typeof globalThis.fetch) {
    return new InitiativeChannel({
      publicId: PUBLIC_ID,
      secret: "shared-secret",
      baseUrl: "https://initiative.internal",
      fetch: doFetch,
    });
  }

  it("asks Initiative to turn a delegate's subject into one of its own refs", async () => {
    const calls: string[] = [];
    const doFetch = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({
          connection_id: "account",
          connection_ref: "ref-abc",
          status: "connected",
          blocked: false,
          account_label: "@alice",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof globalThis.fetch;

    const found = await channel(doFetch).resolveDelegate(42, "acme.auto", "pairwise-xyz");

    expect(found?.connection_ref).toBe("ref-abc");
    expect(calls[0]).toBe(
      `https://initiative.internal${CHANNEL_BASE}/installs/42/connections/resolve` +
        `?delegate=acme.auto&subject=pairwise-xyz`
    );
  });

  it("answers null for every reason there is no member credential", async () => {
    // No such member, no connection with this app, and a deployment older than
    // the route all mean the same thing at the call site: act as the
    // installation, or refuse. Distinguishing them would be a branch with no
    // different behaviour behind it.
    const doFetch = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "not found" }), { status: 404 })
    ) as unknown as typeof globalThis.fetch;

    expect(await channel(doFetch).resolveDelegate(42, "acme.auto", "nobody")).toBeNull();
  });

  it("raises anything that is not an ordinary absence", async () => {
    // A deployment that is down is not "this member has not connected", and
    // treating it as one would silently downgrade every call to the app's own
    // credential for as long as the outage lasted.
    const doFetch = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "boom" }), { status: 503 })
    ) as unknown as typeof globalThis.fetch;

    await expect(
      channel(doFetch).resolveDelegate(42, "acme.auto", "pairwise-xyz")
    ).rejects.toThrow(/503/);
  });
});
