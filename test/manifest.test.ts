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
  type Endpoint,
  type EndpointParam,
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
      features: ["embeds"],
      embeds: [{ id: "e", path: "https://elsewhere.test/e", name: { en: "E" } }],
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].where).toContain("/embeds/0/path");
  });

  it("catches an endpoint that could never run", () => {
    // An empty actor list is a declaration that resolves to nothing: the call
    // arrives, no credential is permitted, and it refuses every time.
    const problems = validateManifest({
      ...base(),
      features: ["endpoints"],
      endpoints: [{ id: "app.acme.tracker.thing", direction: "write", actors: [] }],
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].where).toContain("/endpoints/0/actors");
  });

  it("catches an endpoint that says nothing about which way it goes", () => {
    // `direction` is what decides who may call it and whether an answer can be
    // cached, so an endpoint without one is not a partial declaration — it is
    // an unanswerable question.
    const problems = validateManifest({
      ...base(),
      features: ["endpoints"],
      endpoints: [{ id: "app.acme.tracker.thing" }],
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].where).toContain("/endpoints/0");
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
        features: ["endpoints"],
        endpoints: [{ id: "app.acme.tracker.s", direction: "read", requires }],
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
      expect(problem.message).not.toContain("not a declared read endpoint");
    }
  });
});

describe("features cross-check", () => {
  it("accepts a manifest that declares nothing and offers nothing", () => {
    expect(validateManifest(base())).toEqual([]);
  });

  it("catches a feature with no block behind it", () => {
    const problems = validateManifest({ ...base(), features: ["endpoints"] });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("endpoints is missing");
  });

  it("catches a block whose feature was never declared", () => {
    const problems = validateManifest({
      ...base(),
      endpoints: [{ id: "app.acme.tracker.issues", direction: "read" }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("not declared");
  });

  it("accepts the two together", () => {
    expect(
      validateManifest({
        ...base(),
        features: ["endpoints"],
        endpoints: [{ id: "app.acme.tracker.issues", direction: "read" }],
      })
    ).toEqual([]);
  });
});

describe("references", () => {
  const widget = (endpoints: string[]) => ({
    id: "w",
    meta: { name: { en: "W" } },
    module_source: "x",
    endpoints,
  });

  it("catches a widget binding an endpoint that does not exist", () => {
    const problems = validateManifest({
      ...base(),
      features: ["widgets", "endpoints"],
      endpoints: [{ id: "app.acme.tracker.known", direction: "read" }],
      widgets: [widget(["app.acme.tracker.absent"])],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("not a declared read endpoint");
  });

  it("catches a widget binding something that does not answer", () => {
    // A write and an emit are both real endpoints, and neither fills a tile:
    // one changes something and returns, the other is posted somewhere else
    // entirely. Binding either declares a widget nothing draws.
    for (const direction of ["write", "emit"]) {
      const problems = validateManifest({
        ...base(),
        features: ["widgets", "endpoints"],
        endpoints: [{ id: "app.acme.tracker.act", direction }],
        widgets: [widget(["app.acme.tracker.act"])],
      });
      expect(problems).toHaveLength(1);
      expect(problems[0].message).toContain("not a declared read endpoint");
    }
  });

  it("catches a requires term naming no declared connection", () => {
    const problems = validateManifest({
      ...base(),
      features: ["endpoints"],
      endpoints: [
        { id: "app.acme.tracker.s", direction: "read", requires: { all_of: ["nope"] } },
      ],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("unknown connection 'nope'");
  });

  it("catches an endpoint namespaced under somebody else", () => {
    // Two apps offering `create-issue` would be two different things under one
    // name, and a caller resolving the wrong one would do the wrong thing
    // successfully — which is worse than an error.
    const problems = validateManifest({
      ...base(),
      features: ["endpoints"],
      endpoints: [{ id: "app.someone-else.thing", direction: "read" }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("app.acme.tracker.");
  });

  it("catches an id declared twice", () => {
    // One id, two answers, and which one a caller reaches depends on iteration
    // order.
    const problems = validateManifest({
      ...base(),
      features: ["endpoints"],
      endpoints: [
        { id: "app.acme.tracker.thing", direction: "read" },
        { id: "app.acme.tracker.thing", direction: "write" },
      ],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("declared twice");
  });

  it("accepts a fully wired manifest", () => {
    expect(
      validateManifest({
        ...base(),
        features: ["endpoints", "widgets"],
        connections: [
          {
            id: "api",
            scope: "static",
            label: { en: "API key" },
            fields: [{ key: "token", type: "secret", label: { en: "Token" } }],
          },
        ],
        endpoints: [
          {
            id: "app.acme.tracker.issues",
            direction: "read",
            requires: { all_of: ["api"] },
            actors: ["member"],
          },
          { id: "app.acme.tracker.issue-open", direction: "write", actors: ["member"] },
          { id: "app.acme.tracker.issue-opened", direction: "emit" },
        ],
        widgets: [widget(["app.acme.tracker.issues"])],
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
    const problems = validateDocument(appDocument({ ...base(), features: ["endpoints"] }));

    expect(messages(problems)).toContain("/definition/features");
  });
});

describe("an empty block is no block", () => {
  // The platform's normalizer drops empty blocks before the cross-check, so a
  // presence test passes a manifest that registration refuses. A real app hit
  // exactly this: it declared a feature over an empty block, validated locally
  // under a presence test, and was turned away at registration.
  it("refuses a feature backed by an empty block", () => {
    const problems = validateManifest({
      ...base(),
      features: ["endpoints"],
      endpoints: [],
    });

    expect(messages(problems)).toContain("missing or empty");
  });

  it("refuses an empty block even with no feature declared", () => {
    const problems = validateManifest({ ...base(), endpoints: [] });
    expect(messages(problems)).toContain("leave it out instead");
  });

  it("still accepts a block that carries something", () => {
    const problems = validateManifest({
      ...base(),
      features: ["endpoints"],
      endpoints: [{ id: "app.acme.tracker.thing-happened", direction: "emit" }],
    });

    expect(problems).toEqual([]);
  });
});

describe("what an endpoint says about itself", () => {
  const withEndpoint = (endpoint: Record<string, unknown>): Manifest =>
    ({
      ...base(),
      features: ["endpoints"],
      endpoints: [{ id: "app.acme.tracker.thing", ...endpoint }],
    }) as Manifest;

  it("accepts a fully described one", () => {
    const problems = validateManifest(
      withEndpoint({
        direction: "write",
        label: { en: "Open an issue" },
        description: { en: "Opens one in the connected repository." },
        group: "issues",
        needs_subject: "tasks",
        params: [{ key: "project", type: "int", label: { en: "Project" } }],
        returns: [
          { key: "issue_url", type: "url", label: { en: "URL" } },
          { key: "labels", type: "string", list: true },
        ],
      })
    );
    expect(messages(problems)).toBe("");
  });

  it("lets an emission carry a label and a payload", () => {
    // The one endpoint chosen without ever being called, so it needs a name
    // more than the others — and its payload is as worth describing as a
    // response is.
    const problems = validateManifest(
      withEndpoint({
        direction: "emit",
        label: { en: "An issue is opened" },
        returns: [{ key: "issue_number", type: "int" }],
      })
    );
    expect(messages(problems)).toBe("");
  });

  it("still refuses a caller side on an emission", () => {
    const problems = validateManifest(
      withEndpoint({ direction: "emit", params: [{ key: "x", type: "string", label: { en: "X" } }] })
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("refuses a select as a return type", () => {
    // A select is a CONTROL, and the value behind one is a string.
    const problems = validateManifest(
      withEndpoint({ direction: "read", returns: [{ key: "k", type: "select" }] })
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("refuses a credential as a return type", () => {
    const problems = validateManifest(
      withEndpoint({ direction: "read", returns: [{ key: "k", type: "secret" }] })
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("catches a name returned twice, which the schema cannot", () => {
    // A consumer binds by name, so one of the two would silently never be
    // reachable — the quiet failure this validator exists for.
    const problems = validateManifest(
      withEndpoint({
        direction: "read",
        returns: [
          { key: "count", type: "int" },
          { key: "count", type: "string" },
        ],
      })
    );
    expect(messages(problems)).toContain("returned twice");
  });

  it("says nothing about an endpoint that describes nothing", () => {
    // Every addition is optional: a manifest that validated before still does.
    expect(messages(validateManifest(withEndpoint({ direction: "read" })))).toBe("");
  });
});

/**
 * The one automation term left, and why it is checked here and nowhere else.
 *
 * The others said how to DRAW a parameter, and they are gone: a manifest
 * describes an API, and a consumer that writes its own steps needs nothing
 * from one to draw them. An identity is different in kind — it says what an
 * operation TOUCHED, which only the app can know.
 */
describe("what an automation consumer will read", () => {
  const withEndpoints = (...endpoints: Endpoint[]): Manifest => ({
    ...base(),
    features: ["endpoints"],
    endpoints,
  });

  it("accepts an identity naming its own single-valued returns", () => {
    const problems = validateManifest(
      withEndpoints({
        id: "app.acme.tracker.open",
        direction: "write",
        returns: [
          { key: "repository", type: "string", label: { en: "R" } },
          { key: "number", type: "int", label: { en: "N" } },
        ],
        identity: { kind: "issue", key: ["repository", "number"] },
      })
    );
    expect(messages(problems)).toBe("");
  });

  it("refuses an identity naming a return the endpoint does not carry", () => {
    // Nothing downstream refuses this: the address resolves to nothing, the
    // suppression looks configured, and a fire is silently dropped.
    const problems = validateManifest(
      withEndpoints({
        id: "app.acme.tracker.open",
        direction: "write",
        returns: [{ key: "number", type: "int", label: { en: "N" } }],
        identity: { kind: "issue", key: ["repository", "number"] },
      })
    );
    expect(messages(problems)).toContain("matches the wrong thing");
  });

  it("refuses an identity naming a list", () => {
    const problems = validateManifest(
      withEndpoints({
        id: "app.acme.tracker.open",
        direction: "write",
        returns: [{ key: "numbers", type: "int", label: { en: "N" }, list: true }],
        identity: { kind: "issue", key: ["numbers"] },
      })
    );
    expect(messages(problems)).toContain("matches the wrong thing");
  });

  it("refuses an identity on a read", () => {
    const problems = validateManifest(
      withEndpoints({
        id: "app.acme.tracker.get",
        direction: "read",
        returns: [{ key: "number", type: "int", label: { en: "N" } }],
        identity: { kind: "issue", key: ["number"] },
      })
    );
    expect(messages(problems)).toContain("no echo to suppress");
  });

  it("takes a parameter that holds several values", () => {
    // Cardinality is a fact about the value, so it stayed when presentation
    // went: a caller building a request has to know whether this takes an array.
    const problems = validateManifest(
      withEndpoints({
        id: "app.acme.tracker.label",
        direction: "write",
        params: [{ key: "labels", type: "string", label: { en: "Labels" }, list: true }],
      })
    );
    expect(messages(problems)).toBe("");
  });

  it("checks a parameter's source against the endpoint it names", () => {
    // Nothing downstream refuses a bad one. A consumer asks the deployment to
    // resolve it, the deployment finds no such return, and the form offers
    // nothing — which looks exactly like a vendor being slow. So this is where
    // an author finds out.
    const source: Endpoint = {
      id: "app.acme.tracker.list-repositories",
      direction: "read",
      returns: [
        { key: "names", type: "string", list: true },
        { key: "owner", type: "string" },
      ],
    };

    const asking = (options_from: EndpointParam["options_from"]) =>
      messages(
        validateManifest(
          withEndpoints(source, {
            id: "app.acme.tracker.find-issues",
            direction: "read",
            params: [
              { key: "repo", type: "string", label: { en: "Repo" }, options_from },
            ],
          })
        )
      );

    expect(
      asking({ endpoint: "app.acme.tracker.list-repositories", key: "names" })
    ).toBe("");

    expect(asking({ endpoint: "app.acme.tracker.nope", key: "names" })).toContain(
      "does not declare"
    );

    expect(
      asking({ endpoint: "app.acme.tracker.list-repositories", key: "titles" })
    ).toContain("is not returned by");

    // A return it does send, but one of them. A menu comes from a column of
    // values, and a consumer reading a scalar where it expected one has
    // nowhere to put it.
    expect(
      asking({ endpoint: "app.acme.tracker.list-repositories", key: "owner" })
    ).toContain("single value");
  });

  it("checks what a source is told against both ends", () => {
    // The chain a form actually walks: pick a repository, and the labels on
    // offer are that repository's. A source that could not be told a sibling's
    // answer would have to offer the whole account's labels, which for anybody
    // with more than one repository is not a menu.
    const source: Endpoint = {
      id: "app.acme.tracker.list-labels",
      direction: "read",
      params: [{ key: "repo", type: "string", label: { en: "Repo" } }],
      returns: [{ key: "names", type: "string", list: true }],
    };

    const asking = (needs: Record<string, string>) =>
      messages(
        validateManifest(
          withEndpoints(source, {
            id: "app.acme.tracker.label",
            direction: "write",
            params: [
              { key: "repo", type: "string", label: { en: "Repo" } },
              {
                key: "labels",
                type: "string",
                label: { en: "Labels" },
                list: true,
                options_from: {
                  endpoint: "app.acme.tracker.list-labels",
                  key: "names",
                  needs,
                },
              },
            ],
          })
        )
      );

    expect(asking({ repo: "repo" })).toBe("");

    // Sent under a name that endpoint does not take: it would ignore the
    // answer and hand back the whole account's worth.
    expect(asking({ repository: "repo" })).toContain("takes no parameter");

    // Naming an answer this endpoint never collects: nothing would ever fill
    // it in, so the source would never be called.
    expect(asking({ repo: "owner" })).toContain("not a parameter of this endpoint");

    // And it cannot be told its own answer: it would have to be filled in
    // before it could offer anything to fill it in with.
    expect(asking({ repo: "labels" })).toContain("cannot be told its own answer");
  });

  it("will not let filling in a form write something", () => {
    const problems = validateManifest(
      withEndpoints(
        {
          id: "app.acme.tracker.open-issue",
          direction: "write",
          returns: [{ key: "names", type: "string", list: true }],
        },
        {
          id: "app.acme.tracker.find-issues",
          direction: "read",
          params: [
            {
              key: "repo",
              type: "string",
              label: { en: "Repo" },
              options_from: {
                endpoint: "app.acme.tracker.open-issue",
                key: "names",
              },
            },
          ],
        }
      )
    );
    expect(messages(problems)).toContain("is a write endpoint");
  });

  it("has nowhere left to say how a parameter should be DRAWN", () => {
    // The rule this whole shape exists to keep. A term here for a control, a
    // default or a bound would let an app define somebody else's product
    // surface — and could still only express what that consumer had already
    // thought of.
    //
    // Enumerated rather than sampled, so adding a term is a deliberate act with
    // this comment in front of it. Every one below answers "what is this value",
    // never "how should it look": a name, a type, whether it is needed, how many
    // of them, and the two that say where the permitted ones come from —
    // `options` for a set that is the same on every deployment, `options_from`
    // for one only the app can know.
    const param = (manifestSchema().$defs as Record<string, any>).endpointParam;
    expect(Object.keys(param.properties).sort()).toEqual(
      ["key", "label", "list", "options", "options_from", "required", "type"].sort()
    );

    // And the shape of the new one is a data reference and nothing else: which
    // endpoint, which return, which return holds a label, and what that
    // endpoint has to be told to answer. No widget, no placeholder, no
    // ordering.
    expect(Object.keys(param.properties.options_from.properties).sort()).toEqual(
      ["endpoint", "key", "label_key", "needs"].sort()
    );
  });
});
