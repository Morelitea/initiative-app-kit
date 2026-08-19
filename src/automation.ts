/**
 * The `automation` block: nodes your app contributes to Initiative's
 * automation editor.
 *
 * Your app ships **no code to the canvas**. A node is a *descriptor* — a label,
 * a few typed fields, a few typed outputs — and the automation service's own
 * generic renderer draws its form, exactly as it does for the built-in nodes.
 * What you serve is the other end: an operation, at a path on your own service,
 * called with a context token scoped to `action` and naming that operation.
 *
 * ```ts
 * const automation: AutomationBlock = {
 *   contract: AUTOMATION_CONTRACT,
 *   domain: { label: { en: "GitHub" }, icon: "Braces" },
 *   nodes: [
 *     {
 *       key: "issue-opened",
 *       category: "trigger",
 *       label: { en: "A GitHub issue is opened" },
 *       event: `app.${PUBLIC_ID}.issue-opened`,
 *       outputs: [{ key: "issue_title", type: "string", label: { en: "Title" } }],
 *       fields: [{ key: "label", type: "string", matches: "issue_labels", label: { en: "Label" } }],
 *     },
 *   ],
 *   operations: [{ id: "create-issue", path: "/actions/create-issue" }],
 * };
 * ```
 *
 * **Initiative does not check any of this.** It stores the block verbatim under
 * a size cap and gives it no meaning — the vocabulary belongs to the automation
 * service, and duplicating it in the platform would be a second definition of a
 * contract the platform does not own. So a mistake here does not fail
 * registration: it fails quietly, as a node that never appears in anybody's
 * palette. {@link validateAutomation} is what turns that into a message.
 *
 * The schema it runs is generated in the automation service from the constants
 * that enforce it, and vendored here (`npm run schema:automation`). As with the
 * manifest schema, **schema-valid is necessary and not sufficient**: four
 * cross-reference rules are not expressible in JSON Schema, and this module
 * checks all four, because each one fails in the same silent way.
 */

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { LocalizedText, Manifest, ValidationProblem } from "./manifest.js";

/** The contract version this kit writes. */
export const AUTOMATION_CONTRACT = 1;

/**
 * What an app may contribute. `logic` is absent and is not an oversight: flow
 * control is resolved from a graph's EDGES rather than by calling anything, so
 * there is nothing for an app to serve.
 */
export type NodeCategory = "trigger" | "condition" | "action";

/**
 * Controls a node's form can render — the same closed set a connection's fields
 * use, so one renderer draws both and you learn one vocabulary.
 *
 * `secret` is absent and stays absent: a node's config is stored inside an
 * automation's graph and shown in an editor. A credential belongs in a
 * connection, which is held in custody and never returned.
 */
export type NodeFieldType = "string" | "url" | "bool" | "select" | "int";

/** What a value carried out of a node may be — the field types minus `select`,
 *  because a select is a control and the value behind one is a string. */
export type NodeOutputType = "string" | "url" | "bool" | "int";

export interface NodeFieldOption {
  value: string;
  label?: LocalizedText;
}

export interface NodeField {
  key: string;
  type: NodeFieldType;
  label: LocalizedText;
  required?: boolean;
  /** Required when `type` is `select`. */
  options?: NodeFieldOption[];
  /**
   * Triggers only. Which of THIS node's outputs this field filters on —
   * equality for a scalar, containment for a `list` one.
   *
   * Omitted, it defaults to the field's own key. A field that matches nothing
   * is refused rather than ignored: a filter that can never match is a control
   * that looks right and is silently dead, which is the failure the automation
   * catalogue is built to refuse.
   */
  matches?: string;
}

export interface NodeOutput {
  key: string;
  type: NodeOutputType;
  label?: LocalizedText;
  /** Several values rather than one. A list cannot be bound into a field that
   *  takes a single value. */
  list?: boolean;
}

export interface AutomationNode {
  /** Namespaced on the way in: `app.<public_id>.<key>`. Two apps can both
   *  contribute a `create-issue` and neither can shadow a built-in. */
  key: string;
  category: NodeCategory;
  label: LocalizedText;
  description?: LocalizedText;
  /** Advisory. An unrecognised glyph falls back to your app's own icon. */
  icon?: string;
  /** Triggers only. Must be one your manifest also declares in `events`. */
  event?: string;
  /** Conditions and actions only. Must name an operation this block serves. */
  operation?: string;
  fields?: NodeField[];
  outputs?: NodeOutput[];
}

export interface AutomationOperation {
  id: string;
  /** A path on your own service, never an address: the base URL comes from the
   *  registration the deployment holds. */
  path: string;
  /** Connection ids that must hold a value before this can be called. */
  requires?: { all_of?: string[]; any_of?: string[] };
}

export interface AutomationDomain {
  /**
   * No id: the drawer is always `app.<your public_id>`, derived from your
   * registration. A publisher-chosen id could collide with a built-in drawer,
   * and both ways that fails are silent.
   */
  label: LocalizedText;
  icon?: string;
}

export interface AutomationBlock {
  contract: number;
  domain?: AutomationDomain;
  nodes?: AutomationNode[];
  operations?: AutomationOperation[];
}

/** The vendored schema, as JSON. */
export function automationSchema(): Record<string, unknown> {
  const here = dirname(fileURLToPath(import.meta.url));
  // `dist/` at runtime, `src/` under vitest — the package root is one up from
  // either, and `schemas/` ships in the tarball.
  const path = join(here, "..", "schemas", "automation-block.json");
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

/** Compiled once — Ajv's compile step is the expensive part, not validation. */
let compiled: ValidateFunction | undefined;

function schemaValidator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    compiled = ajv.compile(automationSchema());
  }
  return compiled;
}

function names(entries: { id?: string }[] | undefined): Set<string> {
  return new Set((entries ?? []).map((entry) => entry.id).filter((id): id is string => !!id));
}

/**
 * Every reason this block would not do what it looks like it does.
 *
 * Pass the whole manifest as the second argument: three of the four
 * cross-reference rules reach outside the block — a trigger's `event` must be
 * one the manifest declares, and an operation's `requires` may only name a
 * connection it declares. Called with the block alone, those two are skipped
 * rather than guessed at.
 */
export function validateAutomation(
  block: unknown,
  manifest?: Partial<Manifest>
): ValidationProblem[] {
  if (typeof block !== "object" || block === null) {
    return [{ where: "", message: "an automation block is a JSON object" }];
  }

  const validate = schemaValidator();
  if (!validate(block)) {
    return (validate.errors ?? []).map((error) => ({
      where: error.instancePath,
      message: `${error.message ?? "is invalid"}${
        error.params && "allowedValues" in error.params
          ? ` (${(error.params.allowedValues as string[]).join(", ")})`
          : ""
      }`,
    }));
  }

  const body = block as AutomationBlock;
  const problems: ValidationProblem[] = [];
  const served = names(body.operations);
  const declaredEvents = new Set(manifest?.events ?? []);
  const declaredConnections = names(manifest?.connections);

  (body.operations ?? []).forEach((operation, index) => {
    if (!manifest?.connections) return;
    const terms = [...(operation.requires?.all_of ?? []), ...(operation.requires?.any_of ?? [])];
    for (const term of terms) {
      if (!declaredConnections.has(term)) {
        problems.push({
          where: `/operations/${index}/requires`,
          message: `names connection '${term}', which this manifest does not declare — the operation could never be satisfied`,
        });
      }
    }
  });

  (body.nodes ?? []).forEach((node, index) => {
    const where = `/nodes/${index}`;
    const outputs = new Set((node.outputs ?? []).map((output) => output.key));

    if (node.category === "trigger") {
      if (node.event && manifest?.events && !declaredEvents.has(node.event)) {
        problems.push({
          where: `${where}/event`,
          message: `'${node.event}' is not in this manifest's 'events' — Initiative refuses to emit an event the pinned definition does not declare, so this trigger could never fire`,
        });
      }
      (node.fields ?? []).forEach((field, fieldIndex) => {
        const matches = field.matches ?? field.key;
        if (!outputs.has(matches)) {
          problems.push({
            where: `${where}/fields/${fieldIndex}`,
            message: `matches '${matches}', which this trigger does not declare as an output — a filter that can never match is a dead control`,
          });
        }
      });
    } else if (node.operation && !served.has(node.operation)) {
      problems.push({
        where: `${where}/operation`,
        message: `names operation '${node.operation}', which this block does not serve`,
      });
    }
  });

  return problems;
}
