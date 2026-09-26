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
  appScope,
  isAppScope,
  manifestSchema,
  validateDocument,
  validateManifest,
  type Endpoint,
  type EndpointParam,
  type Manifest,
} from "../src/manifest.js";
import { SCOPES } from "../src/contract.js";

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

  it("takes admin_only as a boolean", () => {
    const read = { direction: "read", returns: [{ key: "total", type: "int" }] };
    expect(messages(validateManifest(withEndpoint({ ...read, admin_only: true })))).toBe("");
    const problems = validateManifest(withEndpoint({ ...read, admin_only: "yes" }));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].where).toBe("/endpoints/0/admin_only");
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

  it("takes public as a boolean on a read or a write", () => {
    const write = { direction: "write", actors: ["member"], public: true };
    expect(messages(validateManifest(withEndpoint(write)))).toBe("");
    const problems = validateManifest(withEndpoint({ ...write, public: "yes" }));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].where).toBe("/endpoints/0/public");
  });

  it("refuses public on an emission, which nobody calls", () => {
    const problems = validateManifest(withEndpoint({ direction: "emit", public: true }));
    expect(problems.map((problem) => problem.where)).toContain("/endpoints/0/public");
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

describe("guild_summary", () => {
  const summary = (over: Partial<Endpoint> = {}): Manifest => ({
    ...base(),
    features: ["endpoints"],
    guild_summary: "app.acme.tracker.standing",
    endpoints: [
      {
        id: "app.acme.tracker.standing",
        direction: "read",
        returns: [{ key: "used", type: "int" }],
        ...over,
      } as Endpoint,
    ],
  });

  it("accepts a read endpoint that declares what it returns", () => {
    expect(validateManifest(summary())).toEqual([]);
  });

  it("refuses an endpoint this app does not have", () => {
    const problems = validateManifest({ ...summary(), guild_summary: "app.acme.tracker.nope" });
    expect(messages(problems)).toContain("not one of this app's endpoints");
  });

  it("refuses one that is not a read", () => {
    // A summary is drawn, so naming something that acts would have a
    // deployment performing an operation to render a page.
    const problems = validateManifest(summary({ direction: "write" }));
    expect(messages(problems)).toContain("not a read");
  });

  it("refuses one that returns nothing", () => {
    // It would resolve, answer, and draw an empty panel — which reads as a
    // deployment that chose not to render it rather than a manifest that
    // cannot be.
    const problems = validateManifest(summary({ returns: [] }));
    expect(messages(problems)).toContain("nothing to draw");
  });

  it("refuses one with a parameter somebody has to answer", () => {
    // Read for a guild, not for a question: there is no form here to fill in.
    const problems = validateManifest(
      summary({
        params: [
          { key: "repo", type: "string", label: { en: "Repo" }, required: true } as EndpointParam,
        ],
      })
    );
    expect(messages(problems)).toContain("'repo'");
    expect(messages(problems)).toContain("no form");
  });

  it("lets an optional parameter through", () => {
    expect(
      validateManifest(
        summary({
          params: [{ key: "repo", type: "string", label: { en: "Repo" } } as EndpointParam],
        })
      )
    ).toEqual([]);
  });

  it("is optional", () => {
    // Most apps have no standing with a guild to report, and saying nothing is
    // the ordinary case rather than an omission.
    expect(validateManifest(base())).toEqual([]);
  });
});

describe("the scopes an app asks for", () => {
  const asking = (scopes: unknown) =>
    validateManifest({ ...base(), service: { public_id: "acme.tracker", scopes } } as never);

  it("takes any set drawn from the vocabulary", () => {
    expect(messages(asking(["projects:read", "comments:write", "members:read"]))).toBe("");
    expect(messages(asking([...SCOPES]))).toBe("");
    expect(messages(asking([]))).toBe("");
  });

  it("is optional", () => {
    expect(messages(validateManifest(base()))).toBe("");
  });

  it("refuses a scope outside the vocabulary", () => {
    for (const scope of ["projects:admin", "members:write", "tasks:read", "PROJECTS:READ", ""]) {
      const problems = asking([scope]);
      expect(problems.length, scope).toBeGreaterThan(0);
      expect(problems[0].where, scope).toBe("/service/scopes/0");
    }
  });

  it("refuses a scope named twice", () => {
    const problems = asking(["projects:read", "projects:read"]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].where).toBe("/service/scopes");
  });

  it("refuses something that is not a list", () => {
    expect(asking("projects:read").length).toBeGreaterThan(0);
  });

  it("takes the scope that lets it call another app", () => {
    expect(messages(asking(["projects:read", appScope("acme.github")]))).toBe("");
  });

  it("refuses an apps: scope that names no app", () => {
    for (const scope of ["apps:", "apps:github", "apps:Acme.github", "apps:acme github"]) {
      const problems = asking([scope]);
      expect(problems.length, scope).toBeGreaterThan(0);
      expect(problems[0].where, scope).toBe("/service/scopes/0");
    }
  });
});

describe("appScope", () => {
  it("names the app it lets you call", () => {
    expect(appScope("acme.github")).toBe("apps:acme.github");
    expect(isAppScope("apps:acme.github")).toBe(true);
  });

  it("refuses what is not a public id", () => {
    expect(() => appScope("github")).toThrow(TypeError);
    expect(isAppScope("apps:github")).toBe(false);
    expect(isAppScope("projects:read")).toBe(false);
    expect(isAppScope(7)).toBe(false);
  });
});

describe("an admin-only surface", () => {
  const withEmbed = (embed: Record<string, unknown>) =>
    validateManifest({
      ...base(),
      features: ["embeds"],
      embeds: [{ id: "settings", path: "/settings", name: { en: "Settings" }, ...embed }],
    } as never);

  it("takes admin_only as a boolean", () => {
    expect(messages(withEmbed({ admin_only: true }))).toBe("");
    expect(messages(withEmbed({ admin_only: false }))).toBe("");
    expect(messages(withEmbed({}))).toBe("");
  });

  it("refuses anything else", () => {
    const problems = withEmbed({ admin_only: "yes" });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].where).toBe("/embeds/0/admin_only");
  });
});

describe("terms the contract does not declare", () => {
  it("reports a surface's visibility, which placement roles replaced", () => {
    const problems = validateManifest({
      ...base(),
      features: ["embeds"],
      embeds: [
        { id: "panel", path: "/panel", name: { en: "Panel" }, visibility: "guild_admin" },
      ],
    } as never);
    expect(problems).toEqual([
      {
        where: "/embeds/0/visibility",
        message: "'visibility' is not a term of the manifest contract, and a deployment discards it",
      },
    ]);
  });

  it("reports an endpoint's visibility", () => {
    const problems = validateManifest({
      ...base(),
      features: ["endpoints"],
      endpoints: [
        {
          id: "app.acme.tracker.read",
          direction: "read",
          returns: [{ key: "n", type: "int" }],
          visibility: "member",
        },
      ],
    } as never);
    expect(problems.map((problem) => problem.where)).toEqual(["/endpoints/0/visibility"]);
  });

  it("reports an unknown term at the top level and in the service block", () => {
    const problems = validateManifest({
      ...base(),
      extra: true,
      service: { public_id: "acme.tracker", secret: "x" },
    } as never);
    expect(problems.map((problem) => problem.where).sort()).toEqual([
      "/extra",
      "/service/secret",
    ]);
  });

  it("leaves open objects alone", () => {
    // Localized text, a widget's meta and its sample data are the author's.
    expect(
      messages(
        validateManifest({
          ...base(),
          features: ["endpoints", "widgets"],
          endpoints: [
            {
              id: "app.acme.tracker.read",
              direction: "read",
              label: { en: "Read", "fr-CA": "Lire" },
              returns: [{ key: "n", type: "int" }],
            },
          ],
          widgets: [
            {
              id: "tile",
              meta: { name: { en: "Tile" }, anything: 1 },
              module_source: "x",
              endpoints: ["app.acme.tracker.read"],
              sample_data: { "app.acme.tracker.read": { n: 1 } },
            },
          ],
        } as never)
      )
    ).toBe("");
  });
});

describe("connections Initiative runs", () => {
  const github = (): Manifest => ({
    ...base(),
    vendor: {
      label: { en: "GitHub App" },
      fields: [
        { key: "client_id", type: "string", required: true, label: { en: "Client id" } },
        { key: "client_secret", type: "secret", required: true, label: { en: "Secret" } },
        { key: "app_slug", type: "string", required: true, label: { en: "Slug" } },
        { key: "app_id", type: "string", required: true, label: { en: "App id" } },
        { key: "private_key", type: "secret", required: true, label: { en: "Key" } },
        { key: "webhook_secret", type: "secret", required: true, label: { en: "Hook" } },
      ],
    },
    webhooks: {
      verify: {
        scheme: "hmac_sha256",
        header: "X-Hub-Signature-256",
        prefix: "sha256=",
        encoding: "hex",
        secret: "{vendor.webhook_secret}",
      },
      dedup: "X-GitHub-Delivery",
      route: { path: "installation.id", connection: "workspace", field: "installation_id" },
    },
    connections: [
      {
        id: "workspace",
        scope: "static",
        label: { en: "Organization" },
        fields: [
          { key: "owner", type: "string", label: { en: "Owner" }, managed: true },
          { key: "installation_id", type: "string", label: { en: "Id" }, managed: true },
        ],
        flow: {
          type: "oauth2",
          authorize_url: "https://github.com/login/oauth/authorize",
          token_url: "https://github.com/login/oauth/access_token",
          client_id: "{vendor.client_id}",
          client_secret: "{vendor.client_secret}",
          install_url: "https://github.com/apps/{vendor.app_slug}/installations/new",
          after_connect: true,
        },
        token: {
          type: "jwt_bearer",
          exchange_url:
            "https://api.github.com/app/installations/{installation_id}/access_tokens",
          iss: "{vendor.app_id}",
          key: "{vendor.private_key}",
          alg: "RS256",
          lifetime: 540,
        },
      },
      {
        id: "account",
        scope: "interactive",
        label: { en: "Your account" },
        fields: [{ key: "login", type: "string", label: { en: "Login" }, managed: true }],
        flow: {
          type: "oauth2",
          authorize_url: "https://github.com/login/oauth/authorize",
          token_url: "https://github.com/login/oauth/access_token",
          client_id: "{vendor.client_id}",
          client_secret: "{vendor.client_secret}",
          scopes: [],
          pkce: true,
          after_connect: true,
          revoke: "hook",
        },
      },
    ],
  });

  it("accepts an installation-style organization and a member's account", () => {
    expect(messages(validateManifest(github()))).toBe("");
  });

  it("names a vendor value the vendor block does not declare", () => {
    const manifest = github();
    manifest.connections![1].flow!.client_id = "{vendor.clientid}";
    const problems = validateManifest(manifest);
    expect(messages(problems)).toContain("'{vendor.clientid}' is not a field of the vendor block");
  });

  it("names a connection field the connection does not declare", () => {
    const manifest = github();
    manifest.connections![0].token!.exchange_url = "https://api.github.com/app/{install}/t";
    expect(messages(validateManifest(manifest))).toContain(
      "'{install}' is not a field of this connection"
    );
  });

  it("insists an interactive connection has a flow", () => {
    const manifest = github();
    delete manifest.connections![1].flow;
    expect(messages(validateManifest(manifest))).toContain("declares a flow");
  });

  it("holds a flow connection's fields to managed values", () => {
    const manifest = github();
    manifest.connections![1].fields[0].managed = false;
    expect(messages(validateManifest(manifest))).toContain("mark the field managed");
  });

  it("insists an install page is a static connection's, and calls after_connect", () => {
    const manifest = github();
    manifest.connections![0].flow!.after_connect = false;
    manifest.connections![1].flow!.install_url = "https://github.com/apps/x/installations/new";
    const text = messages(validateManifest(manifest));
    expect(text).toContain("/connections/0/flow/install_url");
    expect(text).toContain("/connections/1/flow/install_url");
  });

  it("insists rfc7009 revocation names where to post", () => {
    const manifest = github();
    manifest.connections![1].flow!.revoke = "rfc7009";
    expect(messages(validateManifest(manifest))).toContain("revoke_url");
  });

  it("keeps a minted token to a static connection", () => {
    const manifest = github();
    manifest.connections![1].token = { ...manifest.connections![0].token! };
    expect(messages(validateManifest(manifest))).toContain("/connections/1/token");
  });

  it("refuses the retired connect_path as a term the contract does not declare", () => {
    const manifest = github() as unknown as { connections: Array<Record<string, unknown>> };
    manifest.connections[1].connect_path = "/connect";
    expect(messages(validateManifest(manifest))).toContain("'connect_path' is not a term");
  });

  it("holds the webhooks secret to one declared vendor value", () => {
    for (const secret of ["{vendor.hook}", "sha={vendor.webhook_secret}", "{installation_id}"]) {
      const manifest = github();
      manifest.webhooks!.verify.secret = secret;
      expect(messages(validateManifest(manifest))).toContain("/webhooks/verify/secret");
    }
  });

  it("routes webhooks by a field of a static connection", () => {
    const interactive = github();
    interactive.webhooks!.route.connection = "account";
    expect(messages(validateManifest(interactive))).toContain(
      "'account' is not a static connection"
    );
    const undeclared = github();
    undeclared.webhooks!.route.field = "org";
    expect(messages(validateManifest(undeclared))).toContain(
      "'org' is not a field of the connection 'workspace'"
    );
  });

  it("refuses a vendor field type outside the vocabulary", () => {
    const manifest = github() as unknown as { vendor: { fields: Array<Record<string, unknown>> } };
    manifest.vendor.fields[0].type = "int";
    expect(validateManifest(manifest).length).toBeGreaterThan(0);
  });
});

describe("schedules", () => {
  const scheduled = (...every: string[]): Manifest => ({
    ...base(),
    schedules: every.map((value, index) => ({ id: `s-${index}`, every: value })),
  });

  it("accepts whole minutes or hours from 5m to 24h", () => {
    expect(messages(validateManifest(scheduled("5m", "15m", "1440m", "6h", "24h")))).toBe("");
  });

  it("refuses an interval outside the bounds or not in minutes or hours", () => {
    for (const every of ["4m", "25h", "1441m", "0h"]) {
      expect(messages(validateManifest(scheduled(every)))).toContain("/schedules/0/every");
    }
    for (const every of ["15", "1.5h", "15s", "m", " 5m"]) {
      expect(validateManifest(scheduled(every)).length).toBeGreaterThan(0);
    }
  });

  it("refuses more than eight, and two with one id", () => {
    expect(validateManifest(scheduled(...Array(9).fill("5m"))).length).toBeGreaterThan(0);
    const twice = scheduled("5m", "1h");
    twice.schedules![1].id = "s-0";
    expect(messages(validateManifest(twice))).toContain("'s-0' is declared twice");
  });
});
