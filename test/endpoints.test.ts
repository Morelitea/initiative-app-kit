/**
 * Answering Initiative's calls to an app's declared endpoints.
 *
 * A call picks from the closed set the app author declared, and the context
 * token it came with must have been minted for that endpoint.
 */

import { describe, expect, it } from "vitest";

import { ENDPOINTS_PATH, parseInvoke } from "../src/endpoints.js";
import type { Endpoint } from "../src/manifest.js";

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
        params: { project: "widgets", title: "It broke" },
      })
    ).toEqual({
      ok: true,
      request: {
        endpoint: "app.acme.tracker.ticket-open",
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
        params: { project: "widgets" },
      }).ok
    ).toBe(true);
  });

  it("refuses anything the app did not declare", () => {
    // The closed set is most of what makes this safe to expose: a caller
    // chooses among things the app author wrote, and cannot describe a request
    // the app then performs.
    expect(parse({ endpoint: "app.acme.tracker.rm-rf", params: {} })).toEqual({
      ok: false,
      error: "this app does not offer 'app.acme.tracker.rm-rf'",
    });
    // Including another app's endpoint, which is why namespacing matters.
    expect(parse({ endpoint: "app.other.app.ticket-open", params: {} }).ok).toBe(
      false
    );
  });

  it("refuses an emit, which travels the other way", () => {
    // There is nothing to call: the app posts these to whoever subscribed, so a
    // caller that means to hear about them wants a subscription instead. Saying
    // which is the difference between a wrong turn and a dead end.
    expect(
      parse({ endpoint: "app.acme.tracker.ticket-opened", params: {} })
    ).toEqual({
      ok: false,
      error:
        "'app.acme.tracker.ticket-opened' is emitted rather than called — subscribe to it instead",
    });
  });

  it("treats missing params as no params rather than refusing", () => {
    const result = parse({ endpoint: "app.acme.tracker.ticket-open" });
    expect(result.ok && result.request.params).toEqual({});
  });

  it("insists on the fields it routes on", () => {
    expect(parse(null).ok).toBe(false);
    expect(parse("a string").ok).toBe(false);
    // `params` is the one field with a default, so an endpoint on its own is
    // a whole request — it was only ever refused for the guild it also had to
    // carry, and the token carries that now.
    expect(parse({ endpoint: DECLARED[0].id }).ok).toBe(true);
    // An array is an object to `typeof`, and would index as one.
    expect(parse({ endpoint: DECLARED[0].id, params: [] }).ok).toBe(false);
  });

  it("puts discovery and invocation on one path", () => {
    expect(ENDPOINTS_PATH).toBe("/v1/endpoints");
  });
});

describe("checking the call against its token", () => {
  const body = { endpoint: "app.acme.tracker.ticket-open", params: {} };

  it("takes a token minted for this endpoint", () => {
    expect(
      parseInvoke(body, DECLARED, { scope: "endpoint", endpoint_id: body.endpoint }).ok
    ).toBe(true);
  });

  it("refuses a token minted for another endpoint", () => {
    expect(
      parseInvoke(body, DECLARED, {
        scope: "endpoint",
        endpoint_id: "app.acme.tracker.open-tickets",
      })
    ).toEqual({
      ok: false,
      error:
        "this token is for 'app.acme.tracker.open-tickets', not 'app.acme.tracker.ticket-open'",
    });
  });

  it("refuses a lifecycle token", () => {
    expect(parseInvoke(body, DECLARED, { scope: "lifecycle" }).ok).toBe(false);
  });
});
