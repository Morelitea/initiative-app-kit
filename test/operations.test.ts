/**
 * Asking an app to act at its vendor.
 *
 * The surface is small on purpose, and the thing worth testing is that it stays
 * small: a caller picks from a closed set an app author wrote, and never
 * describes a request the app then performs. Everything below is about that
 * boundary holding, plus the one property that keeps a delegated write honest —
 * the actor is always reported.
 */

import { describe, expect, it, vi } from "vitest";

import { CHANNEL_BASE, InitiativeChannel } from "../src/channel.js";
import {
  OPERATIONS_PATH,
  operationProblems,
  parseInvoke,
  type OperationDeclaration,
} from "../src/operations.js";

const PUBLIC_ID = "acme.tracker";

const DECLARED: OperationDeclaration[] = [
  {
    id: "app.acme.tracker.ticket-open",
    actors: ["member", "installation"],
    params: ["project", "title"],
  },
  {
    id: "app.acme.tracker.ticket-comment",
    actors: ["member"],
    params: ["ticket", "body"],
  },
];

describe("invoking one", () => {
  const parse = (body: unknown) => parseInvoke(body, DECLARED);

  it("takes a well-formed request", () => {
    expect(
      parse({
        operation: "app.acme.tracker.ticket-open",
        guild_id: 42,
        params: { project: "widgets", title: "It broke" },
      })
    ).toEqual({
      ok: true,
      request: {
        operation: "app.acme.tracker.ticket-open",
        guild_id: 42,
        params: { project: "widgets", title: "It broke" },
      },
    });
  });

  it("refuses anything the app did not declare", () => {
    // The closed set is most of what makes this safe to expose: a caller
    // chooses among things the app author wrote, and cannot describe a request
    // the app then performs.
    expect(parse({ operation: "app.acme.tracker.rm-rf", guild_id: 42, params: {} })).toEqual({
      ok: false,
      error: "this app does not offer 'app.acme.tracker.rm-rf'",
    });
    // Including another app's operation, which is why namespacing matters.
    expect(
      parse({ operation: "app.other.app.ticket-open", guild_id: 42, params: {} }).ok
    ).toBe(false);
  });

  it("treats missing params as no params rather than refusing", () => {
    const result = parse({ operation: "app.acme.tracker.ticket-open", guild_id: 42 });
    expect(result.ok && result.request.params).toEqual({});
  });

  it("insists on the fields it routes on", () => {
    expect(parse(null).ok).toBe(false);
    expect(parse("a string").ok).toBe(false);
    expect(parse({ guild_id: 42 }).ok).toBe(false);
    expect(parse({ operation: DECLARED[0].id }).ok).toBe(false);
    expect(parse({ operation: DECLARED[0].id, guild_id: "42" }).ok).toBe(false);
    // An array is an object to `typeof`, and would index as one.
    expect(parse({ operation: DECLARED[0].id, guild_id: 42, params: [] }).ok).toBe(false);
  });
});

describe("declaring them", () => {
  it("accepts a well-formed list", () => {
    expect(operationProblems(PUBLIC_ID, DECLARED)).toEqual([]);
  });

  it("insists every operation is namespaced under the app", () => {
    // Two apps offering `create-issue` would be two different things under one
    // name, and a caller resolving the wrong one would do the wrong thing
    // successfully — which is worse than an error.
    expect(
      operationProblems(PUBLIC_ID, [{ id: "create-issue", actors: ["member"], params: [] }])
    ).toEqual(["'create-issue' is not namespaced under 'app.acme.tracker.'"]);
    expect(
      operationProblems(PUBLIC_ID, [
        { id: "app.acme.tracker.", actors: ["member"], params: [] },
      ])
    ).toHaveLength(1);
  });

  it("catches an id declared twice", () => {
    const twice = [DECLARED[0], { ...DECLARED[0], params: [] }];
    expect(operationProblems(PUBLIC_ID, twice)).toEqual([
      "'app.acme.tracker.ticket-open' is declared twice",
    ]);
  });

  it("catches an operation that could never run", () => {
    expect(
      operationProblems(PUBLIC_ID, [
        { id: "app.acme.tracker.ticket-open", actors: [], params: [] },
      ])
    ).toEqual(["'app.acme.tracker.ticket-open' names no actor it could run as"]);
  });

  it("puts discovery and invocation on one path", () => {
    expect(OPERATIONS_PATH).toBe("/v1/operations");
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
    // treating it as one would silently downgrade every write to the app's own
    // credential for as long as the outage lasted.
    const doFetch = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "boom" }), { status: 503 })
    ) as unknown as typeof globalThis.fetch;

    await expect(
      channel(doFetch).resolveDelegate(42, "acme.auto", "pairwise-xyz")
    ).rejects.toThrow(/503/);
  });
});
