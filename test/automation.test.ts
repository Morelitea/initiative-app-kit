import { describe, expect, it } from "vitest";

import {
  AUTOMATION_CONTRACT,
  automationSchema,
  validateAutomation,
  type AutomationBlock,
} from "../src/automation.js";
import type { Manifest } from "../src/manifest.js";

const PUBLIC_ID = "morelitea.github";
const EVENT = `app.${PUBLIC_ID}.issue-opened`;

const TRIGGER = {
  key: "issue-opened",
  category: "trigger" as const,
  label: { en: "A GitHub issue is opened" },
  event: EVENT,
  outputs: [
    { key: "issue_title", type: "string" as const, label: { en: "Title" } },
    { key: "issue_labels", type: "string" as const, list: true, label: { en: "Labels" } },
  ],
  fields: [{ key: "label", type: "string" as const, matches: "issue_labels", label: { en: "Label" } }],
};

const ACTION = {
  key: "create-issue",
  category: "action" as const,
  label: { en: "Open a GitHub issue" },
  operation: "create-issue",
  fields: [{ key: "title", type: "string" as const, required: true, label: { en: "Title" } }],
  outputs: [{ key: "issue_url", type: "url" as const, label: { en: "URL" } }],
};

function block(overrides: Partial<AutomationBlock> = {}): AutomationBlock {
  return {
    contract: AUTOMATION_CONTRACT,
    domain: { label: { en: "GitHub" }, icon: "Braces" },
    nodes: [TRIGGER, ACTION],
    operations: [{ id: "create-issue", path: "/actions/create-issue" }],
    ...overrides,
  };
}

function manifest(overrides: Partial<Manifest> = {}): Partial<Manifest> {
  return {
    app_kind: "service",
    service: { public_id: PUBLIC_ID },
    features: ["automations"],
    events: [EVENT],
    ...overrides,
  };
}

describe("the vendored schema", () => {
  it("is the one this contract version describes", () => {
    const schema = automationSchema() as { properties: { contract: { const: number } } };
    expect(schema.properties.contract.const).toBe(AUTOMATION_CONTRACT);
  });
});

describe("a block that is right", () => {
  it("passes", () => {
    expect(validateAutomation(block(), manifest())).toEqual([]);
  });

  it("passes without a manifest, skipping the rules that need one", () => {
    expect(validateAutomation(block())).toEqual([]);
  });
});

describe("what the schema catches", () => {
  it("refuses a category an app may not contribute", () => {
    // Flow control is resolved from a graph's edges; there is nothing to serve.
    const problems = validateAutomation(block({ nodes: [{ ...ACTION, category: "logic" as never }] }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it("refuses `secret` as a field type", () => {
    const problems = validateAutomation(
      block({
        nodes: [{ ...ACTION, fields: [{ key: "k", type: "secret" as never, label: { en: "K" } }] }],
      })
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("refuses a trigger with no event", () => {
    const { event: _event, ...noEvent } = TRIGGER;
    const problems = validateAutomation(block({ nodes: [noEvent as never] }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it("refuses an operation path that climbs", () => {
    const problems = validateAutomation(
      block({ operations: [{ id: "create-issue", path: "/actions/../secrets" }] })
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("refuses a contract this kit does not write", () => {
    expect(validateAutomation(block({ contract: 2 })).length).toBeGreaterThan(0);
  });

  it("refuses something that is not an object at all", () => {
    expect(validateAutomation("nope")).toEqual([
      { where: "", message: "an automation block is a JSON object" },
    ]);
  });
});

describe("what only the whole manifest catches", () => {
  // Each of these is schema-valid, and each fails in the same silent way: the
  // registration succeeds, the app installs, and a node never appears or never
  // fires. That is why they are worth checking here rather than leaving to the
  // service's own refusal.

  it("names the output a trigger filter matches", () => {
    const problems = validateAutomation(
      block({
        nodes: [{ ...TRIGGER, fields: [{ key: "nope", type: "string", label: { en: "?" } }] }],
      }),
      manifest()
    );
    expect(problems[0].message).toContain("dead control");
  });

  it("accepts a filter whose key IS the output's", () => {
    const problems = validateAutomation(
      block({
        nodes: [{ ...TRIGGER, fields: [{ key: "issue_title", type: "string", label: { en: "T" } }] }],
      }),
      manifest()
    );
    expect(problems).toEqual([]);
  });

  it("catches an operation nobody serves", () => {
    const problems = validateAutomation(block({ operations: [] }), manifest());
    expect(problems[0].message).toContain("does not serve");
  });

  it("catches an event the manifest does not declare", () => {
    const problems = validateAutomation(block(), manifest({ events: [] }));
    expect(problems[0].message).toContain("could never fire");
  });

  it("catches a requires term naming no connection", () => {
    const problems = validateAutomation(
      block({
        operations: [
          { id: "create-issue", path: "/actions/create-issue", requires: { all_of: ["missing"] } },
        ],
      }),
      manifest({ connections: [] })
    );
    expect(problems[0].message).toContain("could never be satisfied");
  });

  it("says nothing about connections when the manifest declares none to check", () => {
    const problems = validateAutomation(
      block({
        operations: [
          { id: "create-issue", path: "/actions/create-issue", requires: { all_of: ["account" ] } },
        ],
      }),
      manifest()
    );
    expect(problems).toEqual([]);
  });
});
