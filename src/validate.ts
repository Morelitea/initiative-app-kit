/**
 * Checking a manifest before a deployment does.
 *
 * **Schema-valid is necessary, not sufficient.** Some rules are not expressible
 * in JSON Schema and are checked by the platform on publish: cross-references
 * (the endpoint a widget binds, a `requires` term's connection, an endpoint's
 * service prefix), the features/blocks cross-check in both directions, UTF-8
 * byte-size caps, the rules tying a connection's `flow` and `token` to its
 * scope and fields, and the bounds and unique ids of `schedules`.
 *
 * {@link validateManifest} runs the schema and then every one of those except
 * the byte caps. It also reports every term the contract does not declare: a
 * deployment drops such a term rather than refusing the manifest, so a
 * misspelt or retired field would otherwise do nothing without saying so. And
 * it adds one rule the platform does not check: an endpoint's `identity` must
 * name returns that endpoint actually sends.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import { CAPS, FEATURES, type Endpoint, type Feature, type Manifest, type Requires } from "./contract.js";

/** Where an app serves its manifest document. */
export const MANIFEST_PATH = "/.well-known/initiative-app.json";

/** The wire protocol this SDK speaks. */
export const APP_PROTOCOL_VERSION = 1;

/**
 * The document served at {@link MANIFEST_PATH}, of which {@link Manifest} is one
 * field: the app's identity beside what it declares it can do. A registrar
 * refuses anything without a `protocol_version`, a `public_id`, a `kind` and a
 * `definition`.
 */
export interface AppDocument {
  protocol_version: number;
  /** `<publisher>.<slug>`, the same id `definition.service.public_id` carries. */
  public_id: string;
  kind: "app";
  /** The catalog id: publisher-assigned, immutable, never reused. */
  uid?: string;
  name?: string;
  definition: Manifest;
}

/**
 * The document to serve at {@link MANIFEST_PATH}. Serve the same bytes every
 * time: a deployment hashes what it fetches and re-checks it.
 */
export function appDocument(
  manifest: Manifest,
  options: { uid?: string; name?: string } = {}
): AppDocument {
  return {
    protocol_version: manifest.service?.protocol ?? APP_PROTOCOL_VERSION,
    public_id: manifest.service?.public_id,
    kind: "app",
    ...(options.uid ? { uid: options.uid } : {}),
    ...(options.name ? { name: options.name } : {}),
    definition: manifest,
  };
}

/**
 * Check a whole served document — the envelope, then the manifest inside it.
 *
 * {@link validateManifest} checks what an app declares; this checks what a
 * registrar will actually fetch. Use it on the bytes you serve.
 */
export function validateDocument(document: unknown): ValidationProblem[] {
  if (typeof document !== "object" || document === null) {
    return [{ where: "", message: "a manifest document is a JSON object" }];
  }
  const body = document as Partial<AppDocument>;
  const problems: ValidationProblem[] = [];

  if (body.protocol_version !== APP_PROTOCOL_VERSION) {
    problems.push({
      where: "/protocol_version",
      message: `must be ${APP_PROTOCOL_VERSION} — a registrar refuses a protocol it does not speak`,
    });
  }
  if (typeof body.public_id !== "string" || !body.public_id.trim()) {
    problems.push({ where: "/public_id", message: "a served document must name its app" });
  }
  if (body.kind !== "app") {
    problems.push({ where: "/kind", message: `must be '${"app"}'` });
  }
  if (body.definition === undefined) {
    problems.push({
      where: "/definition",
      message: "the manifest goes here — a document without one declares nothing",
    });
    // Nothing further to say: every check below reads the definition.
    return problems;
  }
  // The two ids are the same id written twice, and a registration matched by
  // one while the capabilities are namespaced under the other is a mismatch
  // nothing downstream would report.
  const declared = (body.definition as Manifest)?.service?.public_id;
  if (typeof body.public_id === "string" && declared && declared !== body.public_id) {
    problems.push({
      where: "/public_id",
      message: `names '${body.public_id}' but the definition declares '${declared}'`,
    });
  }

  return [
    ...problems,
    ...validateManifest(body.definition).map((problem) => ({
      where: `/definition${problem.where}`,
      message: problem.message,
    })),
  ];
}

/**
 * Which manifest block backs each declared feature.
 *
 * Derived from the contract's feature list rather than restated: a feature and
 * its block share a name, and a second list could only ever be missing one —
 * which is what left this package unable to declare `dashboards` for a release.
 */
const FEATURE_BLOCKS = Object.fromEntries(
  FEATURES.map((feature) => [feature, feature])
) as Record<Feature, keyof Manifest>;

/** The generated schema, read from disk once. */
export function manifestSchema(): Record<string, unknown> {
  const here = dirname(fileURLToPath(import.meta.url));
  // Resolved relative to the built module so it works from `dist/` and `src/`.
  for (const candidate of ["../schemas/app-manifest.json", "../../schemas/app-manifest.json"]) {
    try {
      return JSON.parse(readFileSync(join(here, candidate), "utf-8"));
    } catch {
      continue;
    }
  }
  throw new Error("app-manifest.json is not packaged beside this module");
}

export interface ValidationProblem {
  /** A JSON Pointer-ish path into the manifest. */
  where: string;
  message: string;
}

/** Compiled once — Ajv's compile step is the expensive part, not validation. */
let compiled: ValidateFunction | undefined;

function schemaValidator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    compiled = ajv.compile(manifestSchema());
  }
  return compiled;
}

/**
 * Everything this side can check: the schema, then the two cross-cutting rules
 * it cannot express.
 *
 * The schema runs first and short-circuits. A manifest whose shape is wrong
 * produces cascading nonsense from the reference checks — "binds 'undefined',
 * which is not a declared read endpoint" when the real answer is "endpoints
 * must be an array" — so the structural answer is worth giving alone.
 *
 * An empty array does not promise the platform will accept it — see the module
 * note — but a non-empty one is a definite refusal, so this is worth running in
 * CI and before a publish.
 */
export function validateManifest(manifest: unknown): ValidationProblem[] {
  if (typeof manifest !== "object" || manifest === null) {
    return [{ where: "", message: "a manifest is a JSON object" }];
  }

  const validate = schemaValidator();
  if (!validate(manifest)) {
    return (validate.errors ?? []).map((error) => ({
      where: error.instancePath,
      message: `${error.message ?? "is invalid"}${
        error.params && "allowedValues" in error.params
          ? ` (${(error.params.allowedValues as string[]).join(", ")})`
          : ""
      }`,
    }));
  }

  const body = manifest as Manifest;
  return [
    ...undeclaredProblems(body),
    ...featureProblems(body),
    ...referenceProblems(body),
    ...connectionProblems(body),
    ...webhookProblems(body),
    ...scheduleProblems(body),
    ...automationProblems(body),
    ...summaryProblems(body),
  ];
}

/**
 * Whether {@link Manifest.guild_summary} names something that can be rendered.
 *
 * Separate from {@link referenceProblems} for the same reason
 * {@link automationProblems} is: nothing downstream refuses this. A deployment
 * that cannot resolve the endpoint draws nothing and says nothing, which looks
 * exactly like a deployment that chose not to render it.
 */
function summaryProblems(body: Manifest): ValidationProblem[] {
  const id = body.guild_summary;
  if (!id) return [];

  const endpoint = (body.endpoints ?? []).find((candidate) => candidate.id === id);
  if (!endpoint) {
    return [
      {
        where: "/guild_summary",
        message: `'${id}' is not one of this app's endpoints`,
      },
    ];
  }

  const problems: ValidationProblem[] = [];
  if (endpoint.direction !== "read") {
    problems.push({
      where: "/guild_summary",
      message: `'${id}' is not a read — a summary is drawn, not performed`,
    });
  }
  if ((endpoint.returns ?? []).length === 0) {
    problems.push({
      where: "/guild_summary",
      message: `'${id}' declares no returns, so there is nothing to draw`,
    });
  }
  const required = (endpoint.params ?? []).filter((param) => param.required);
  if (required.length > 0) {
    problems.push({
      where: "/guild_summary",
      message:
        `'${id}' requires ${required.map((p) => `'${p.key}'`).join(", ")} — a summary is ` +
        "read for a guild, and there is no form to answer a parameter in",
    });
  }
  return problems;
}

/**
 * Every identity that names something its endpoint does not carry.
 *
 * What is left of a larger set of checks, and the reduction is the point: the
 * others covered terms that told a consumer how to DRAW a parameter, and those
 * terms are gone. An identity is not one of them. It says what an operation
 * TOUCHED, which only you can know, and it is what lets a consumer keep a
 * change your app made from firing the automation that made it.
 *
 * Kept apart from {@link referenceProblems} because those are early copies of
 * platform refusals and this is not: nothing downstream refuses an identity
 * naming a return you do not send. It resolves to nothing, the suppression it
 * feeds looks configured, and a fire somebody was waiting on is silently
 * dropped. This is where that surfaces.
 */
function automationProblems(body: Manifest): ValidationProblem[] {
  const problems: ValidationProblem[] = [];

  (body.endpoints ?? []).forEach((endpoint, index) => {
    if (!endpoint.identity) return;
    const where = `/endpoints/${index}`;
    if (endpoint.direction === "read") {
      problems.push({
        where: `${where}/identity`,
        message: "a read touched nothing, so there is no echo to suppress",
      });
    }
    const single = new Set(
      (endpoint.returns ?? []).filter((value) => !value.list).map((value) => value.key)
    );
    for (const part of endpoint.identity.key) {
      if (!single.has(part)) {
        problems.push({
          where: `${where}/identity/key`,
          message:
            `'${part}' is not a single-valued return of this endpoint — an address built from ` +
            "the parts that happen to be there matches the wrong thing",
        });
      }
    }
  });

  return problems;
}

type SchemaNode = {
  $ref?: string;
  items?: SchemaNode;
  properties?: Record<string, SchemaNode>;
};

/**
 * Every key the contract does not declare, depth first.
 *
 * Walks the schema itself: a node names a `$ref`, carries `items`, or carries
 * `properties`, and each is followed the same way at every depth. An object the
 * contract leaves open (localized text, a widget's `meta`, a binding's
 * `params`) declares no properties, and nothing inside it is checked.
 */
function undeclaredProblems(body: Manifest): ValidationProblem[] {
  const schema = manifestSchema() as SchemaNode & { $defs?: Record<string, SchemaNode> };
  const defs = schema.$defs ?? {};
  const problems: ValidationProblem[] = [];

  const resolve = (node: SchemaNode | undefined): SchemaNode | undefined =>
    node?.$ref ? defs[node.$ref.slice("#/$defs/".length)] : node;

  const walk = (value: unknown, node: SchemaNode | undefined, where: string): void => {
    const shape = resolve(node);
    if (!shape) return;
    if (shape.items) {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, shape.items, `${where}/${index}`));
      }
      return;
    }
    if (!shape.properties || typeof value !== "object" || value === null || Array.isArray(value)) {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const declared = shape.properties[key];
      if (!declared) {
        problems.push({
          where: `${where}/${key}`,
          message: `'${key}' is not a term of the manifest contract, and a deployment discards it`,
        });
        continue;
      }
      walk(child, declared, `${where}/${key}`);
    }
  };

  walk(body, schema, "");
  return problems;
}

/**
 * Every declared feature backed by a block, and every block declared.
 *
 * **An empty block is no block**, and testing for the key's presence instead is
 * the mistake this note exists to stop. The platform's normalizer drops empty
 * blocks *before* it runs this cross-check, so `"automation": {}` never reaches
 * it and the feature reads as declared over nothing — refused. A manifest with
 * one validates locally under a presence test and is turned away at
 * registration, which has happened to a real app.
 *
 * So an empty block is reported twice over, deliberately: once as the feature it
 * fails to back, and once on its own, because leaving it out is the fix either
 * way and a block that is never sent cannot be misread.
 */
function featureProblems(body: Manifest): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const declared = new Set(body.features ?? []);
  for (const [feature, block] of Object.entries(FEATURE_BLOCKS) as Array<
    [Feature, keyof Manifest]
  >) {
    const value = body[block];
    // What survives the normalizer: present, and carrying something.
    const present =
      value !== undefined &&
      value !== null &&
      (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0);

    if (declared.has(feature) && !present) {
      problems.push({
        where: "/features",
        message:
          `the '${feature}' feature is declared but ${String(block)} is missing or empty — ` +
          "an empty block is dropped before the platform checks, so it reads as absent",
      });
    }
    if (present && !declared.has(feature)) {
      problems.push({
        where: `/${String(block)}`,
        message: `${String(block)} is present but the '${feature}' feature is not declared`,
      });
    }
    if (value !== undefined && !present) {
      problems.push({
        where: `/${String(block)}`,
        message: `${String(block)} is empty — leave it out instead`,
      });
    }
  }
  return problems;
}

/** Ids that must name something the manifest itself declares. */
function referenceProblems(body: Manifest): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const connectionIds = new Set((body.connections ?? []).map((c) => c.id));

  const checkRequires = (requires: Requires | undefined, where: string) => {
    if (!requires) return;
    // The schema already refused anything but exactly one operator, so this is
    // a cheap invariant rather than a second gate — it keeps the loop below
    // from reading a key that is not there if this is ever called directly.
    const named = (["all_of", "any_of"] as const).filter((key) => key in requires);
    if (named.length !== 1) return;
    for (const id of requires[named[0]] ?? []) {
      if (!connectionIds.has(id)) {
        problems.push({ where, message: `requires names unknown connection '${id}'` });
      }
    }
  };

  // One namespace across every direction, which is what lets a caller resolve
  // an id without being told which kind of thing it is first.
  const prefix = `app.${body.service?.public_id}.`;
  const readable = new Set<string>();
  const declared = new Set<string>();
  // Kept by id so a parameter naming a source can be checked against what that
  // endpoint actually returns, not merely against its existence.
  const byId = new Map<string, Endpoint>();

  (body.endpoints ?? []).forEach((endpoint, index) => {
    const where = `/endpoints/${index}`;
    if (!endpoint.id.startsWith(prefix) || endpoint.id.length === prefix.length) {
      problems.push({
        where: `${where}/id`,
        message: `endpoint ids are namespaced under your service id — '${prefix}…'`,
      });
    }
    if (declared.has(endpoint.id)) {
      problems.push({ where: `${where}/id`, message: `'${endpoint.id}' is declared twice` });
    }
    declared.add(endpoint.id);
    if (endpoint.direction === "read") readable.add(endpoint.id);
    byId.set(endpoint.id, endpoint);
    checkRequires(endpoint.requires, `${where}/requires`);

    // An emission travels the other way — nobody calls it — so a caller side on
    // one describes a call that never happens: a form nobody fills, a gate
    // nobody passes, a cache with nothing to hold. The platform refuses it, and
    // the schema cannot say so because the rule is conditional on `direction`.
    //
    // `label`, `description`, `returns` and `group` are deliberately NOT in
    // this list: an emission is the one endpoint chosen without ever being
    // called, so describing it matters more here than anywhere.
    if (endpoint.direction === "emit") {
      for (const key of ["params", "requires", "cache_ttl_seconds", "actors", "public"]) {
        if ((endpoint as unknown as Record<string, unknown>)[key] !== undefined) {
          problems.push({
            where: `${where}/${key}`,
            message: `an emit endpoint has no ${key} — nobody calls it`,
          });
        }
      }
    }

    // Two returns under one name is a value a consumer cannot address: it binds
    // by name, and one of the two would silently never be reachable.
    const returned = new Set<string>();
    (endpoint.returns ?? []).forEach((value, position) => {
      if (returned.has(value.key)) {
        problems.push({
          where: `${where}/returns/${position}`,
          message: `'${value.key}' is returned twice — a consumer binds by name`,
        });
      }
      returned.add(value.key);
    });
  });

  // A parameter that names where its values come from, checked against the
  // endpoint it names. Nothing downstream refuses a bad one: a consumer asks
  // the deployment to resolve it, the deployment finds no such return, and the
  // form quietly offers nothing — which looks exactly like a vendor being slow.
  // This is where an author finds out instead.
  (body.endpoints ?? []).forEach((endpoint, index) => {
    (endpoint.params ?? []).forEach((param, position) => {
      const source = param.options_from;
      if (!source) return;
      const where = `/endpoints/${index}/params/${position}/options_from`;

      const named = byId.get(source.endpoint);
      if (!named) {
        problems.push({
          where,
          message: `names '${source.endpoint}', which this manifest does not declare`,
        });
        return;
      }
      if (named.direction !== "read") {
        // Filling in a form must not be able to change anything.
        problems.push({
          where,
          message: `names '${source.endpoint}', which is a ${named.direction} endpoint`,
        });
        return;
      }

      for (const [field, key] of [
        ["key", source.key],
        ["label_key", source.label_key],
      ] as const) {
        if (key === undefined) continue;
        const value = (named.returns ?? []).find((one) => one.key === key);
        if (!value) {
          problems.push({
            where: `${where}/${field}`,
            message: `'${key}' is not returned by '${source.endpoint}'`,
          });
        } else if (value.list !== true) {
          // A menu comes from a list. `returns` is how an endpoint says which
          // of its values hold several, and a consumer reading a scalar where
          // it expected a column has nowhere to put it.
          problems.push({
            where: `${where}/${field}`,
            message: `'${key}' is a single value — options come from a list`,
          });
        }
      }

      // What the source is told, checked at both ends: the name it is sent
      // under has to be a parameter that endpoint takes, and the answer sent
      // under it has to be one this endpoint collects. Either half wrong and
      // the source is called with a parameter it ignores or never called at
      // all, both of which reach a person as an empty menu.
      for (const [sends, answer] of Object.entries(source.needs ?? {})) {
        const at = `${where}/needs/${sends}`;
        if (!(named.params ?? []).some((one) => one.key === sends)) {
          problems.push({
            where: at,
            message: `'${source.endpoint}' takes no parameter '${sends}'`,
          });
        }
        if (answer === param.key) {
          // It would have to be answered before it could offer an answer.
          problems.push({
            where: at,
            message: `'${answer}' is this parameter — it cannot be told its own answer`,
          });
        } else if (!(endpoint.params ?? []).some((one) => one.key === answer)) {
          problems.push({
            where: at,
            message: `'${answer}' is not a parameter of this endpoint`,
          });
        }
      }
    });
  });

  (body.embeds ?? []).forEach((embed, index) =>
    checkRequires(embed.requires, `/embeds/${index}/requires`)
  );
  (body.widgets ?? []).forEach((widget, index) => {
    checkRequires(widget.requires, `/widgets/${index}/requires`);
    for (const id of widget.endpoints ?? []) {
      // The restriction is the widget's, not the endpoint's: a widget draws
      // what it is given, so it can only bind one that answers. An automation
      // reaching the same endpoint is under no such rule.
      if (!readable.has(id)) {
        problems.push({
          where: `/widgets/${index}/endpoints`,
          message: `binds '${id}', which is not a declared read endpoint`,
        });
      }
    }
  });

  return problems;
}

/**
 * The rules tying a connection's flow and token to its scope and fields, and
 * every `{…}` a flow or token names.
 *
 * The platform refuses each of these on publish; they are repeated here so an
 * author finds out before that.
 */
function connectionProblems(body: Manifest): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const vendorKeys = new Set((body.vendor?.fields ?? []).map((field) => field.key));

  (body.connections ?? []).forEach((connection, index) => {
    const where = `/connections/${index}`;
    const fieldKeys = new Set(connection.fields.map((field) => field.key));
    const flow = connection.flow;

    if (connection.scope === "interactive" && !flow) {
      problems.push({
        where,
        message: "an interactive connection declares a flow — each member authorizes their own account",
      });
    }
    if (connection.scope === "static" && !flow && connection.fields.length === 0) {
      problems.push({
        where: `${where}/fields`,
        message: "a static connection without a flow declares at least one field for an admin to fill in",
      });
    }
    if (flow) {
      connection.fields.forEach((field, position) => {
        if (field.managed !== true) {
          problems.push({
            where: `${where}/fields/${position}`,
            message: "a connection with a flow holds only managed values — mark the field managed",
          });
        }
      });
      if (connection.fields.length > 0 && flow.after_connect !== true) {
        problems.push({
          where: `${where}/flow/after_connect`,
          message: "managed values come from the after_connect hook, which this flow does not call",
        });
      }
      if (flow.install_url !== undefined) {
        if (connection.scope !== "static") {
          problems.push({
            where: `${where}/flow/install_url`,
            message: "an install page is for a static connection, which an organization installs",
          });
        }
        if (flow.after_connect !== true) {
          problems.push({
            where: `${where}/flow/install_url`,
            message: "an installation-style flow calls after_connect, which checks who installed it",
          });
        }
      }
      if (flow.revoke === "rfc7009" && !flow.revoke_url) {
        problems.push({
          where: `${where}/flow/revoke_url`,
          message: "rfc7009 revocation posts to revoke_url, which is missing",
        });
      }
    }
    if (connection.token && connection.scope !== "static") {
      problems.push({
        where: `${where}/token`,
        message: "a minted token belongs to a static connection",
      });
    }

    const templated: Array<[string, string | undefined]> = [];
    if (flow) {
      for (const key of [
        "authorize_url",
        "token_url",
        "client_id",
        "client_secret",
        "install_url",
        "revoke_url",
      ] as const) {
        templated.push([`${where}/flow/${key}`, flow[key]]);
      }
      for (const [name, value] of Object.entries(flow.authorize_params ?? {})) {
        templated.push([`${where}/flow/authorize_params/${name}`, value]);
      }
    }
    if (connection.token) {
      for (const key of ["exchange_url", "iss", "key"] as const) {
        templated.push([`${where}/token/${key}`, connection.token[key]]);
      }
    }
    for (const [at, value] of templated) {
      for (const name of templateNames(value ?? "")) {
        if (name.startsWith("vendor.")) {
          if (!vendorKeys.has(name.slice("vendor.".length))) {
            problems.push({ where: at, message: `'{${name}}' is not a field of the vendor block` });
          }
        } else if (!fieldKeys.has(name)) {
          problems.push({ where: at, message: `'{${name}}' is not a field of this connection` });
        }
      }
    }
  });

  return problems;
}

/**
 * What a webhooks block names: its secret is one vendor value, and its route
 * is a field of a static connection.
 */
function webhookProblems(body: Manifest): ValidationProblem[] {
  const webhooks = body.webhooks;
  if (!webhooks) return [];
  const problems: ValidationProblem[] = [];
  const vendorKeys = new Set((body.vendor?.fields ?? []).map((field) => field.key));
  const secret = webhooks.verify.secret;
  const names = templateNames(secret);
  const key = names.length === 1 && names[0]?.startsWith("vendor.") ? names[0].slice(7) : null;
  if (key === null || secret !== `{vendor.${key}}`) {
    problems.push({
      where: "/webhooks/verify/secret",
      message: "the signing secret is one vendor value, written '{vendor.<key>}'",
    });
  } else if (!vendorKeys.has(key)) {
    problems.push({
      where: "/webhooks/verify/secret",
      message: `'{vendor.${key}}' is not a field of the vendor block`,
    });
  }

  const { connection: connectionId, field } = webhooks.route;
  const connection = (body.connections ?? []).find((entry) => entry.id === connectionId);
  if (!connection || connection.scope !== "static") {
    problems.push({
      where: "/webhooks/route/connection",
      message: `'${connectionId}' is not a static connection this app declares`,
    });
  } else if (!connection.fields.some((entry) => entry.key === field)) {
    problems.push({
      where: "/webhooks/route/field",
      message: `'${field}' is not a field of the connection '${connectionId}'`,
    });
  }
  return problems;
}

/** Each schedule's interval is within the bounds, and no two share an id. */
function scheduleProblems(body: Manifest): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const seen = new Set<string>();
  (body.schedules ?? []).forEach((schedule, index) => {
    const where = `/schedules/${index}`;
    if (seen.has(schedule.id)) {
      problems.push({ where: `${where}/id`, message: `'${schedule.id}' is declared twice` });
    }
    seen.add(schedule.id);
    const count = Number(schedule.every.slice(0, -1));
    const minutes = schedule.every.endsWith("h") ? count * 60 : count;
    if (minutes < CAPS.scheduleMinMinutes || minutes > CAPS.scheduleMaxMinutes) {
      problems.push({
        where: `${where}/every`,
        message: `every is at least ${CAPS.scheduleMinMinutes}m and at most ${CAPS.scheduleMaxMinutes / 60}h`,
      });
    }
  });
  return problems;
}

/** Every `{name}` in a template, in order. */
export function templateNames(value: string): string[] {
  const names: string[] = [];
  let start = value.indexOf("{");
  while (start !== -1) {
    const end = value.indexOf("}", start + 1);
    if (end === -1) break;
    names.push(value.slice(start + 1, end));
    start = value.indexOf("{", end + 1);
  }
  return names;
}
