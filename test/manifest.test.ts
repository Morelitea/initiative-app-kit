/**
 * What the kit can tell an author before a deployment does.
 *
 * The cases are the two rules `validateManifest` adds on top of the schema —
 * the features cross-check and the id references — because those are the ones
 * an author trips over and the ones JSON Schema cannot express. The schema
 * itself is the platform's, tested there.
 */

import { describe, expect, it } from "vitest";

import {
  appDocument,
  manifestSchema,
  validateDocument,
  validateManifest,
  type Manifest,
} from "../src/manifest.js";

const base = (): Manifest => ({
  app_kind: "service",
  service: { public_id: "acme.tracker", protocol: 1 },
  features: [],
});

const messages = (problems: Array<{ where: string; message: string }>) =>
  problems.map((problem) => `${problem.where}: ${problem.message}`).join("\n");

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

describe("the document a registrar actually fetches", () => {
  // The distinction this whole block exists for: a `Manifest` is what an app
  // declares, and a registrar never fetches one. It fetches the document around
  // it, and refuses anything without the envelope. A bare manifest served at
  // the well-known path is well-formed and unregisterable — which is exactly
  // how the reference app was wrong, with nothing on either side saying so.
  it("wraps a manifest in the envelope a registrar requires", () => {
    const document = appDocument(base(), { uid: "K7M2QX8N4TVB9C", name: "Tracker" });

    expect(document.protocol_version).toBe(1);
    expect(document.public_id).toBe("acme.tracker");
    expect(document.kind).toBe("app");
    expect(document.uid).toBe("K7M2QX8N4TVB9C");
    expect(document.definition).toEqual(base());
  });

  it("leaves out what was not supplied rather than sending nulls", () => {
    // The document is hashed and re-checked; a key present as null is a byte
    // difference that says nothing.
    const document = appDocument(base());
    expect("uid" in document).toBe(false);
    expect("name" in document).toBe(false);
  });

  it("accepts what appDocument builds", () => {
    expect(validateDocument(appDocument(base()))).toEqual([]);
  });

  it("refuses a bare manifest, which is the mistake worth catching", () => {
    const problems = validateDocument(base());

    expect(problems.length).toBeGreaterThan(0);
    expect(messages(problems)).toContain("/definition");
  });

  it("refuses a protocol the registrar does not speak", () => {
    const problems = validateDocument({ ...appDocument(base()), protocol_version: 2 });
    expect(messages(problems)).toContain("/protocol_version");
  });

  it("refuses a kind that is not an app", () => {
    const problems = validateDocument({ ...appDocument(base()), kind: "tool" });
    expect(messages(problems)).toContain("/kind");
  });

  it("catches the two public ids disagreeing", () => {
    // The registration is matched by the outer id and the capabilities are
    // namespaced under the inner one, so a mismatch is a real app that half
    // works, and nothing downstream reports it.
    const problems = validateDocument({ ...appDocument(base()), public_id: "acme.other" });

    expect(messages(problems)).toContain("but the definition declares 'acme.tracker'");
  });

  it("reports the manifest's own problems, at their path inside it", () => {
    const problems = validateDocument(appDocument({ ...base(), features: ["events"] }));

    expect(messages(problems)).toContain("/definition/features");
  });
});

describe("an empty block is no block", () => {
  // The platform's normalizer drops empty blocks before the cross-check, so a
  // presence test passes a manifest that registration refuses. A real app hit
  // exactly this, declaring `automations` over an `automation: {}`.
  it("refuses a feature backed by an empty block", () => {
    const problems = validateManifest({
      ...base(),
      features: ["automations"],
      automation: {},
    });

    expect(messages(problems)).toContain("missing or empty");
  });

  it("refuses an empty block even with no feature declared", () => {
    const problems = validateManifest({ ...base(), events: [] });
    expect(messages(problems)).toContain("leave it out instead");
  });

  it("still accepts a block that carries something", () => {
    const problems = validateManifest({
      ...base(),
      features: ["events"],
      events: ["app.acme.tracker.thing-happened"],
    });

    expect(problems).toEqual([]);
  });
});
