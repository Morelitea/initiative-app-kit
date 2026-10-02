/**
 * A declarative app's requests and mappings, run against recorded answers
 * exactly as Initiative will run them: what is sent, what each answer means,
 * and the bounds every expression is evaluated within.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { CAPS } from "../src/contract.js";
import { evaluate, runAfterConnect, runEndpoint, runHealth, runWebhook } from "../src/testing.js";
import { issuesApp } from "./support/app.js";

const app = issuesApp();
const now = "2026-10-02T12:00:00.000Z";
const workspace = { workspace: { owner: "acme" } };

afterEach(() => vi.restoreAllMocks());

describe("runEndpoint", () => {
  it("renders each page's request, and maps every page's items", async () => {
    const run = await runEndpoint(app, "open-issues", {
      params: { state: "Open" },
      connections: workspace,
      now,
      responses: [{ body: [{ title: "A" }, { title: "B" }] }, { body: [{ title: "C" }] }],
    });
    expect(run).toEqual({
      requests: [1, 2].map((page) => ({
        method: "GET",
        url: `https://api.tracker.example/repos/acme/issues?state=open&page=${page}&per_page=2`,
        headers: { Accept: "application/json" },
        connection: "workspace",
      })),
      result: { titles: ["A", "B", "C"], total: 3 },
    });
  });

  it("refuses a range past max_pages when on_limit says so", async () => {
    const full = { body: [{ title: "A" }, { title: "B" }] };
    const run = await runEndpoint(app, "open-issues", { connections: workspace, now, responses: [full, full] });
    expect(run).toMatchObject({ unavailable: "range-too-large" });
  });

  it("runs steps in order, each reading the ones before it", async () => {
    const run = await runEndpoint(app, "label", {
      params: { number: 7, label: "bug" },
      connections: workspace,
      now,
      responses: [{ body: [{ name: "ui" }] }, { body: [{ name: "ui" }, { name: "bug" }] }],
    });
    expect(run.requests[1]).toEqual({
      method: "PUT",
      url: "https://api.tracker.example/issues/7/labels",
      headers: {},
      body: { labels: ["ui", "bug"] },
      connection: "workspace",
    });
    expect(run).toMatchObject({ result: { labels: ["ui", "bug"] } });
  });

  it.each([
    [{ status: 422, body: { message: "locked" } }, { unavailable: "locked" }],
    [{ status: 422, body: { message: "bad" } }, { unavailable: "invalid" }],
    [{ status: 404 }, { unavailable: "not-found" }],
    [{ status: 403 }, { unavailable: "not-authorized" }],
    [{ status: 429 }, { transient: true }],
    [{ status: 502 }, { transient: true }],
  ])("answers %j with its rule or the default", async (response, answered) => {
    const run = await runEndpoint(app, "label", { params: { number: 7 }, connections: workspace, now, responses: [response] });
    expect(run).toEqual({ requests: [expect.objectContaining({ method: "GET" })], ...answered });
  });

  it("sends a GraphQL cursor in its variable, from the second page", async () => {
    const page = (ids: string[], more: boolean) => ({
      body: { data: { issues: { nodes: ids.map((id) => ({ id })), pageInfo: { endCursor: ids.at(-1), hasNextPage: more } } } },
    });
    const run = await runEndpoint(app, "search", { now, responses: [page(["a"], true), page(["b"], false)] });
    expect(run.requests.map((request) => (request.body as { variables: unknown }).variables)).toEqual([
      { after: null },
      { after: "a" },
    ]);
    expect(run).toMatchObject({ result: { ids: ["a", "b"] } });
  });

  it("reads each connection the endpoint requires as connections.<id>, beside the request's own", async () => {
    const run = await runEndpoint(app, "assign", {
      params: { number: 7 },
      connections: { ...workspace, account: {}, elsewhere: { owner: "other" } },
      now,
      responses: [{ status: 201, body: { assignee: "alice" } }],
    });
    expect(run).toEqual({
      requests: [
        {
          method: "POST",
          url: "https://api.tracker.example/repos/acme/issues/7/assignees",
          headers: {},
          body: { assignee: "me", seen: ["workspace", "account"] },
          connection: "account",
        },
      ],
      result: { assignee: "alice" },
    });
  });

  it("fails on an answer that does not fit the returns, and on a response nothing asked for", async () => {
    await expect(
      runEndpoint(app, "open-issues", { connections: workspace, now, responses: [{ body: [{ title: 1 }] }] })
    ).rejects.toThrow("answered 'titles' as 1, which is not string");
    await expect(
      runEndpoint(app, "open-issues", { connections: workspace, now, responses: [{ body: [] }, { body: [] }] })
    ).rejects.toThrow("1 recorded response(s) were not asked for");
  });
});

describe("runAfterConnect", () => {
  const pages = [
    { headers: { Link: '<https://api.tracker.example/user/installations?page=2>; rel="next"' }, body: { installations: [{ id: "1", account: "other" }] } },
    { body: { installations: [{ id: "2", account: "acme" }] } },
  ];

  it("follows the Link header and maps the installation it came back with", async () => {
    const run = await runAfterConnect(app, "workspace", { params: { installation_id: "2" }, now, responses: pages });
    expect(run.requests.map((request) => request.url)).toEqual([
      "https://api.tracker.example/user/installations",
      "https://api.tracker.example/user/installations?page=2",
    ]);
    expect(run).toMatchObject({ result: { values: { owner: "acme" }, account_label: "acme" } });
  });

  it("answers mapping-failed, saying why, for a next page off the app's hosts", async () => {
    const away = { headers: { Link: '<https://elsewhere.example/more>; rel="next"' }, body: { installations: [] } };
    const run = await runAfterConnect(app, "workspace", { now, responses: [away] });
    expect(run).toMatchObject({ unavailable: "mapping-failed", requests: [{ url: "https://api.tracker.example/user/installations" }] });
    expect("detail" in run && run.detail).toContain("https://elsewhere.example/more is not https on one of the app's hosts");
  });

  it("refuses when refuse_when holds", async () => {
    const run = await runAfterConnect(app, "workspace", { params: { installation_id: "9" }, now, responses: pages });
    expect(run).toMatchObject({ refused: "not-installed" });
  });
});

describe("runHealth", () => {
  it.each([
    [{ status: 200 }, "ok"],
    [{ status: 404 }, "removed"],
    [{ status: 403, body: { reason: "suspended" } }, "suspended"],
    [{ status: 500 }, "unavailable"],
  ])("reads %j as %s", async (response, state) => {
    const run = await runHealth(app, "workspace", { fields: { owner: "acme" }, now, responses: [response] });
    expect(run.requests[0].url).toBe("https://api.tracker.example/installations/acme");
    expect(run).toMatchObject({ result: state });
  });
});

describe("runWebhook", () => {
  it("emits the first matching event, and sets a connection's state", async () => {
    expect(
      await runWebhook(app, {
        headers: { "X-Event": "issues" },
        payload: { action: "opened", issue: { number: 7, title: "Broken" } },
      })
    ).toEqual({ event: { emit: "issue-opened", payload: { number: 7, title: "Broken" } } });
    expect(await runWebhook(app, { headers: { "X-Event": "installation" }, payload: { action: "suspend" } })).toEqual({
      status: { connection: "workspace", state: "suspended" },
    });
    expect(await runWebhook(app, { headers: { "X-Event": "push" }, payload: {} })).toEqual({});
  });
});

describe("evaluate", () => {
  it("answers $now() and $millis() at the call's time", async () => {
    expect(await evaluate("[$now(), $millis()]", {}, { now })).toEqual([now, Date.parse(now)]);
  });

  it("is bounded in depth, time and the size of its answer", async () => {
    await expect(evaluate("($f := function($n) { $f($n + 1) + 1 }; $f(0))", {})).rejects.toThrow("Stack overflow");
    await expect(evaluate(`$pad("", ${CAPS.expressionOutputBytes}, "x")`, {})).rejects.toThrow(
      `over ${CAPS.expressionOutputBytes} bytes`
    );
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(CAPS.expressionTimeMs + 1);
    await expect(evaluate("[1, 2].($ * 2)", {})).rejects.toThrow(`timeout after ${CAPS.expressionTimeMs} milliseconds`);
  });
});
