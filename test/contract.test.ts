/**
 * The contract and what is generated from it.
 *
 * `manifest.contract.json` is the one hand-authored statement of what a manifest
 * may say. Two things are generated from it — the JSON Schema this package ships
 * and the types it exports — and Initiative vendors it to build its validator's
 * vocabulary. These tests are what stop the three from drifting apart, which is
 * the failure this arrangement exists to remove.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTOR_KINDS,
  CAPS,
  CHARSETS,
  CONNECTION_SCOPES,
  DIRECTIONS,
  EMBED_CAPABILITIES,
  FEATURES,
  AUTOMATION_VOCABULARY_REF,
  AUTOMATION_VOCABULARY_VERSION,
  FIELDS,
  FIELD_TYPES,
  PARAM_TYPES,
  RESOURCE_KINDS,
  RETURN_VALUE_TYPES,
  SURFACE_SCOPES,
  VISIBILITIES,
  VISIBILITY_LADDER,
} from "../src/contract.js";
import { FEATURE_BLOCKS, manifestSchema } from "../src/manifest.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(join(root, "manifest.contract.json"), "utf-8"));
const schema = manifestSchema() as Record<string, any>;

describe("the generated files are what the contract says", () => {
  // The one test that makes every other guarantee here real: an edited contract
  // with un-regenerated output would otherwise pass everything below by
  // comparing two stale files to each other.
  it("regenerating produces no change", () => {
    expect(() =>
      execFileSync("node", [join(root, "scripts", "generate.mjs"), "--check"], {
        cwd: root,
        stdio: "pipe",
      })
    ).not.toThrow();
  });
});

describe("the schema draws its vocabulary from the contract", () => {
  const cases: Array<[string, readonly unknown[], unknown[]]> = [
    ["features", FEATURES, schema.properties.features.items.enum],
    ["connection scopes", CONNECTION_SCOPES, schema.$defs.connection.properties.scope.enum],
    ["field types", FIELD_TYPES, schema.$defs.connectionField.properties.type.enum],
    ["param types", PARAM_TYPES, schema.$defs.endpointParam.properties.type.enum],
    ["return types", RETURN_VALUE_TYPES, schema.$defs.endpointReturn.properties.type.enum],
    ["directions", DIRECTIONS, schema.$defs.endpoint.properties.direction.enum],
    ["actor kinds", ACTOR_KINDS, schema.$defs.endpoint.properties.actors.items.enum],
    ["visibilities", VISIBILITIES, schema.$defs.embed.properties.visibility.enum],
    ["surface scopes", SURFACE_SCOPES, schema.$defs.embed.properties.scopes.items.enum],
    [
      "embed capabilities",
      EMBED_CAPABILITIES,
      schema.$defs.embed.properties.capabilities.items.enum,
    ],
  ];

  it.each(cases)("%s match", (_name, exported, inSchema) => {
    expect([...exported]).toEqual(inSchema);
  });

  it("the visibility ladder holds exactly the visibility vocabulary", () => {
    expect([...VISIBILITY_LADDER].sort()).toEqual([...VISIBILITIES].sort());
  });

  it("a secret is a credential, never a query parameter", () => {
    expect(FIELD_TYPES).toContain("secret");
    expect(PARAM_TYPES).not.toContain("secret");
    expect(RETURN_VALUE_TYPES).not.toContain("secret");
  });
});

describe("the field inventory", () => {
  it("names every property the schema declares, and no others", () => {
    for (const [owner, fields] of Object.entries(FIELDS)) {
      const node = owner === "manifest" ? schema : schema.$defs[owner];
      expect(Object.keys(node.properties), owner).toEqual([...fields]);
    }
  });

  it("covers every object the schema defines", () => {
    const withProperties = Object.entries(schema.$defs)
      .filter(([, node]: [string, any]) => node.properties)
      .map(([name]) => name);
    expect(Object.keys(FIELDS).filter((k) => k !== "manifest").sort()).toEqual(
      withProperties.sort()
    );
  });
});

describe("features and the blocks behind them", () => {
  // The drift this whole arrangement was built to stop: `dashboards` was a
  // feature the platform accepted and this package's types had no way to write.
  it("every feature has a block", () => {
    expect(Object.keys(FEATURE_BLOCKS).sort()).toEqual([...FEATURES].sort());
  });

  it("every feature's block is a property of the manifest", () => {
    for (const block of Object.values(FEATURE_BLOCKS)) {
      expect(FIELDS.manifest).toContain(block);
    }
  });
});

describe("caps and character sets", () => {
  it("every cap the contract names is a positive integer", () => {
    for (const [name, value] of Object.entries(CAPS)) {
      expect(Number.isInteger(value), name).toBe(true);
      expect(value, name).toBeGreaterThan(0);
    }
  });

  it("a character set widened in the contract widens the schema's pattern", () => {
    // Spot-checked against the one pattern every id in the document is built
    // from, so a generator that stopped reading the contract fails here.
    for (const character of CHARSETS.identifier) {
      expect(new RegExp(schema.$defs.identifier.pattern).test(character)).toBe(true);
    }
    expect(new RegExp(schema.$defs.identifier.pattern).test("A")).toBe(false);
  });

  it("the caps the contract quotes in prose are interpolated, not left as braces", () => {
    const prose = JSON.stringify(schema);
    expect(prose).not.toMatch(/\{[a-z][A-Za-z]+\}/);
    expect(schema.$defs.localizedText.description).toContain(String(CAPS.textLength));
  });

  it("names every upper bound rather than restating its value", () => {
    // "Raise it in one place" is only true if no site carries the number. Upper
    // bounds are the caps; lower bounds (minItems: 1, minimum: 0) are the shape
    // of the thing rather than a limit anyone would raise, so they stay literal.
    const sites = JSON.stringify({ defs: contract.defs, manifest: contract.manifest });
    for (const keyword of ["maxItems", "maxLength", "maxProperties", "maximum"]) {
      const inline = [...sites.matchAll(new RegExp(`"${keyword}":(\\d+)`, "g"))];
      expect(inline.map((match) => match[1]), keyword).toEqual([]);
    }
  });
});

/**
 * The one part of the contract this package does not write.
 *
 * What an endpoint parameter may SAY is a fact about what an automation
 * consumer can DRAW, which is not knowable here — `picker: "project"` was an
 * editor's word for an editor's control, written into a third party's
 * manifest, so the vocabulary belonged to whoever drew it. `initiative-auto`
 * publishes it; this package vendors it at a pin.
 */
describe("the vendored automation vocabulary", () => {
  const vocabulary = JSON.parse(
    readFileSync(new URL("../schemas/automation-vocabulary.json", import.meta.url), "utf-8")
  );

  it("is what the generated enums say", () => {
    expect([...PARAM_TYPES]).toEqual(vocabulary.param_types);
    expect([...RETURN_VALUE_TYPES]).toEqual(vocabulary.return_types);
    expect([...RESOURCE_KINDS]).toEqual(vocabulary.resource_kinds);
  });

  it("is pinned to a revision, so a change over there is not a red build here", () => {
    expect(AUTOMATION_VOCABULARY_REF).toMatch(/^[0-9a-f]{40}$/);
    expect(AUTOMATION_VOCABULARY_VERSION).toBe(vocabulary.vocabulary_version);
  });

  it("bounds this contract's caps by what the consumer's reader truncates at", () => {
    // The reader drops the overflow. Refusing here is what stops an author
    // discovering the drop by counting controls in somebody else's canvas.
    expect(CAPS.paramsPerEndpoint).toBeLessThanOrEqual(vocabulary.caps.fields_per_node);
    expect(CAPS.returnsPerEndpoint).toBeLessThanOrEqual(vocabulary.caps.outputs_per_node);
    expect(CAPS.selectOptions).toBeLessThanOrEqual(vocabulary.caps.options_per_field);
    expect(CAPS.endpoints).toBeLessThanOrEqual(vocabulary.caps.nodes_per_app);
    expect(CAPS.sourceParams).toBe(vocabulary.caps.source_params);
    expect(CAPS.identityKeyParts).toBe(vocabulary.caps.identity_key_parts);
  });

  it("names each vendored term in the contract rather than restating it", () => {
    // The tell that generation is real: a hand-written enum here would pass
    // every test above and then silently stop tracking the consumer.
    const contractText = JSON.stringify(contract.enums);
    expect(contractText).toContain("fromVocabulary");
    expect(contract.enums.paramType).toEqual({ fromVocabulary: "param_types" });
    expect(contract.enums.resourceKind).toEqual({ fromVocabulary: "resource_kinds" });
  });
});
