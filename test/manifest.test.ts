/**
 * What the kit can tell an author before a deployment does.
 *
 * The cases are the two rules `validateManifest` adds on top of the schema —
 * the features cross-check and the id references — because those are the ones
 * an author trips over and the ones JSON Schema cannot express. The schema
 * itself is the platform's, tested there.
 */

import { describe, expect, it } from "vitest";

import { manifestSchema, validateManifest, type Manifest } from "../src/manifest.js";

const base = (): Manifest => ({
  app_kind: "service",
  service: { public_id: "acme.tracker", protocol: 1 },
  features: [],
});

describe("manifestSchema", () => {
  it("ships beside the module", () => {
    const schema = manifestSchema();
    expect(schema.$id).toContain("app-manifest");
    expect((schema.properties as Record<string, unknown>).service).toBeDefined();
  });

  it("says what schema-valid does not prove", () => {
    // The asymmetry travels with the file, so an implementer who reads only the
    // schema still learns the platform is authoritative.
    expect(String(manifestSchema().description)).toContain("not necessarily");
  });
});

describe("the schema actually runs", () => {
  // The point of these: the package ships a schema, and a schema nothing
  // executes is decoration. Each of these is caught by the schema alone —
  // the hand-written checks below would not notice any of them.
  it("catches a public id that is not '<publisher>.<slug>'", () => {
    const problems = validateManifest({ ...base(), service: { public_id: "nodot" } });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].where).toContain("public_id");
  });

  it("catches a path that is an address rather than a route", () => {
    const problems = validateManifest({
      ...base(),
      features: ["data"],
      data_sources: [{ id: "s", path: "https://elsewhere.test/data" }],
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].where).toContain("/data_sources/0/path");
  });

  it("catches a capability no surface may request", () => {
    const problems = validateManifest({
      ...base(),
      features: ["embeds"],
      embeds: [{ id: "e", path: "/e", name: { en: "E" }, capabilities: ["payment"] }],
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].where).toContain("capabilities");
  });

  it("catches a field type outside the vocabulary", () => {
    const problems = validateManifest({
      ...base(),
      connections: [
        {
          id: "api",
          scope: "static",
          label: { en: "API" },
          fields: [{ key: "t", type: "telepathy", label: { en: "T" } }],
        },
      ],
    });
    expect(problems.length).toBeGreaterThan(0);
  });

  it("catches requires naming both operators or neither", () => {
    // The schema owns this one now — `oneOf` over the two operators — so it is
    // reported before the hand-written reference checks run at all.
    for (const requires of [{ all_of: ["a"], any_of: ["b"] }, {}]) {
      const problems = validateManifest({
        ...base(),
        features: ["data"],
        data_sources: [{ id: "s", path: "/d", requires }],
      });
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.every((p) => p.where.endsWith("/requires"))).toBe(true);
      expect(problems.some((p) => p.message.includes("exactly one"))).toBe(true);
    }
  });

  it("reports the schema alone when the shape is wrong", () => {
    // Structural problems short-circuit, so an author is not handed cascading
    // nonsense from checks that assume the shape held.
    const problems = validateManifest({
      ...base(),
      features: ["widgets"],
      widgets: "not a list",
    });
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem.message).not.toContain("unknown data source");
    }
  });
});

describe("features cross-check", () => {
  it("accepts a manifest that declares nothing and offers nothing", () => {
    expect(validateManifest(base())).toEqual([]);
  });

  it("catches a feature with no block behind it", () => {
    const problems = validateManifest({ ...base(), features: ["data"] });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("data_sources is missing");
  });

  it("catches a block whose feature was never declared", () => {
    const problems = validateManifest({
      ...base(),
      data_sources: [{ id: "issues", path: "/data/issues" }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("not declared");
  });

  it("accepts the two together", () => {
    expect(
      validateManifest({
        ...base(),
        features: ["data"],
        data_sources: [{ id: "issues", path: "/data/issues" }],
      })
    ).toEqual([]);
  });
});

describe("references", () => {
  it("catches a widget binding a data source that does not exist", () => {
    const problems = validateManifest({
      ...base(),
      features: ["widgets", "data"],
      data_sources: [{ id: "known", path: "/d" }],
      widgets: [
        { id: "w", meta: { name: { en: "W" } }, module_source: "x", sources: ["absent"] },
      ],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("unknown data source 'absent'");
  });

  it("catches a requires term naming no declared connection", () => {
    const problems = validateManifest({
      ...base(),
      features: ["data"],
      data_sources: [{ id: "s", path: "/d", requires: { all_of: ["nope"] } }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("unknown connection 'nope'");
  });

  it("catches an event namespaced under somebody else", () => {
    const problems = validateManifest({
      ...base(),
      features: ["events"],
      events: ["app.someone-else.thing"],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("app.acme.tracker.");
  });

  it("accepts a fully wired manifest", () => {
    expect(
      validateManifest({
        ...base(),
        features: ["data", "widgets", "events"],
        connections: [
          {
            id: "api",
            scope: "static",
            label: { en: "API key" },
            fields: [{ key: "token", type: "secret", label: { en: "Token" } }],
          },
        ],
        data_sources: [{ id: "issues", path: "/d", requires: { all_of: ["api"] } }],
        widgets: [
          { id: "w", meta: { name: { en: "W" } }, module_source: "x", sources: ["issues"] },
        ],
        events: ["app.acme.tracker.issue-opened"],
      })
    ).toEqual([]);
  });
});

describe("shape", () => {
  it("refuses something that is not an object", () => {
    expect(validateManifest("not a manifest")).toHaveLength(1);
    expect(validateManifest(null)).toHaveLength(1);
  });
});
