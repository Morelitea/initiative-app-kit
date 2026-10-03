/**
 * The endpoint's request and map, run against a recorded GitLab answer as
 * Initiative runs them, and the widget drawing what it answers.
 */

import { describe, expect, it } from "vitest";
import { runEndpoint } from "initiative-app-sdk/testing";

import app from "../src/app.js";
import { render } from "../src/widgets/open-issues.js";
import statistics from "./fixtures/issues-statistics.json" with { type: "json" };

describe("issue-counts", () => {
  it("asks GitLab for the project's statistics, and maps the counts", async () => {
    const run = await runEndpoint(app, "issue-counts", {
      params: { project: "gitlab-org/gitlab" },
      responses: [{ body: statistics }],
    });
    expect(run).toEqual({
      requests: [
        {
          method: "GET",
          url: "https://gitlab.com/api/v4/projects/gitlab-org%2Fgitlab/issues_statistics",
          headers: {},
          connection: "gitlab",
        },
      ],
      result: { opened: 12, closed: 30 },
    });
  });

  it("answers not-found for a project GitLab does not show the account", async () => {
    const run = await runEndpoint(app, "issue-counts", {
      params: { project: "acme/secret" },
      responses: [{ status: 404, body: { message: "404 Project Not Found" } }],
    });
    expect(run).toMatchObject({ unavailable: "not-found" });
  });
});

describe("the open-issues widget", () => {
  it("draws the open count", () => {
    expect(render({ source: "app", rows: [], values: { opened: 12, closed: 30 } })).toEqual({
      v: 1,
      scene: { kind: "metric", value: 12, label: "Open issues", caption: "30 closed" },
    });
  });
});
