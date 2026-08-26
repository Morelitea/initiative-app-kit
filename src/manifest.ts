/**
 * The manifest your app serves, and checking it before a deployment does.
 *
 * The schema shipped beside this module is generated from the platform's own
 * validator vocabulary, so what it accepts is what a deployment accepts — with
 * one asymmetry worth knowing, stated in the schema's own description and
 * repeated here because it decides how much this can promise:
 *
 * **Schema-valid is necessary, not sufficient.** Four classes of rule are not
 * expressible in JSON Schema and are checked by the platform on publish:
 * cross-references (a widget's endpoints, a `requires` term's connection, an
 * endpoint's service prefix), the features/blocks cross-check in both
 * directions, UTF-8 byte-size caps, and the conditional rules for
 * `connect_path` and initiative visibility.
 *
 * {@link validateManifest} runs the schema and then adds the first two of those,
 * because they are cheap to check here and are the two an author trips over
 * most. The byte caps and the conditional rules are left to the platform.
 *
 * The schema itself is not written here — it is generated in the Initiative
 * repository from the validator's own vocabulary and vendored into this package,
 * with CI checking the copy against upstream (`npm run check:schema`). It ships
 * rather than being fetched because validation has to work offline.
 */

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Where a deployment fetches your manifest document. */
export const MANIFEST_PATH = "/.well-known/initiative-app.json";

/** The wire protocol this kit speaks. */
export const APP_PROTOCOL_VERSION = 1;

/** The only listing kind that names a container to call. */
export const APP_KIND = "app";

export type ConnectionScope = "static" | "interactive";
export type FieldType = "string" | "secret" | "url" | "bool" | "select" | "int";
export type ParamType = Exclude<FieldType, "secret">;
export type Visibility = "member" | "initiative_manager" | "guild_admin";
export type SurfaceScope = "guild" | "initiative";
/**
 * What an app can declare it offers.
 *
 * `endpoints` is the whole of the app's callable surface — what it will answer,
 * what it will do, and what it will announce. `widgets` and `embeds` are the
 * two ways an app puts something on a screen, and both draw on endpoints.
 */
export type Feature = "widgets" | "embeds" | "endpoints";

export type LocalizedText = Record<string, string>;

export interface Requires {
  all_of?: string[];
  any_of?: string[];
}

export interface ConnectionField {
  key: string;
  type: FieldType;
  label: LocalizedText;
  required?: boolean;
  options?: string[];
  /** Written back by your app when a vendor flow finishes, not typed by an admin. */
  managed?: boolean;
}

export interface Connection {
  id: string;
  scope: ConnectionScope;
  label: LocalizedText;
  fields: ConnectionField[];
  /** Interactive connections only: where the member is sent for the vendor flow. */
  connect_path?: string;
  access_hint?: { api?: string; scopes?: string[] };
}

/**
 * Which way a call across an endpoint travels.
 *
 * `read` and `write` are both request/response and differ only in whether the
 * caller expects the app to change something at its vendor. `emit` is the
 * other direction: a subscriber registers a URL and the app posts to it.
 */
export type Direction = "read" | "write" | "emit";

/** Whose credential a call runs on. */
export type ActorKind = "member" | "installation";

/** One parameter a caller may send. */
export type EndpointParam = Omit<ConnectionField, "type" | "managed"> & {
  type: ParamType;
};

/**
 * One thing an app will do when something connects to it.
 *
 * A single vocabulary for every caller. A widget filling a tile, an automation
 * service asking the app to act, and a subscriber waiting to be told all name
 * an id from this list, and what separates them is which token they prove
 * themselves with — not which route they found.
 *
 * The id is the address. There is no path to choose, so two apps cannot answer
 * the same question at different URLs, and a caller that knows the id needs
 * nothing else to make the call.
 */
export interface Endpoint {
  /** `app.<public id>.<name>`, so two apps' endpoints never collide. */
  id: string;
  direction: Direction;
  /** `read` and `write`: what the caller may send. */
  params?: EndpointParam[];
  /** `read` and `write`: which connections must be satisfied before the call. */
  requires?: Requires;
  /** `read`: how long an answer may be reused. */
  cache_ttl_seconds?: number;
  /** `read`: who may reach it. */
  visibility?: Exclude<Visibility, "initiative_manager">;
  /**
   * `read` and `write`: which credentials this will run on, best first.
   *
   * A caller reads this to know what it is asking for. An endpoint listing only
   * `member` refuses when the member has connected nothing, rather than quietly
   * acting as the app instead — the right choice for anything whose whole
   * meaning is *who* did it.
   */
  actors?: ActorKind[];
}

export interface Widget {
  id: string;
  meta: Record<string, unknown>;
  module_source: string;
  /** Read endpoints this widget draws from. */
  endpoints?: string[];
  sample_data?: Record<string, unknown>;
  requires?: Requires;
}

export interface Embed {
  id: string;
  path: string;
  name: LocalizedText;
  scopes?: SurfaceScope[];
  visibility?: Visibility;
  capabilities?: string[];
  requires?: Requires;
}

export interface Manifest {
  app_kind: "service";
  service: { public_id: string; protocol?: number };
  features: Feature[];
  default_name?: string;
  connections?: Connection[];
  endpoints?: Endpoint[];
  widgets?: Widget[];
  embeds?: Embed[];
}

/**
 * The document served at {@link MANIFEST_PATH}, of which {@link Manifest} is one
 * field.
 *
 * This distinction is the one an app author gets wrong first, because the two
 * are both called "the manifest": {@link Manifest} is what an app *declares* —
 * its capabilities — and it is what the schema describes and
 * {@link validateManifest} checks. The registrar does not fetch that. It
 * fetches this, and refuses anything without a `protocol_version`, a
 * `public_id`, a `kind` and a `definition`. A `Manifest` served bare is
 * well-formed and unregisterable.
 *
 * The reason for the split is that a served document is *listing-shaped*: an
 * app describes itself in the same vocabulary an operator-authored catalog
 * entry uses, so what it serves can be published as a listing. The identity
 * lives out here because it identifies the listing; the capabilities live in
 * `definition` because they are what the app can do.
 *
 * Build one with {@link appDocument} rather than by hand.
 */
export interface AppDocument {
  /** Refused by number rather than guessed at if it is not one the build speaks. */
  protocol_version: number;
  /** `<publisher>.<slug>`, the same id `definition.service.public_id` carries. */
  public_id: string;
  kind: typeof APP_KIND;
  /**
   * The catalog id — publisher-assigned, immutable, never reused. It is what
   * ties a verified registration to its listing, so **without it a registration
   * verifies but names nothing**, and an install marked mandatory is skipped as
   * "has not verified yet". Optional here because the registrar tolerates its
   * absence; supply one for anything you publish.
   */
  uid?: string;
  /**
   * Display name for the listing. The registrar does not read it today —
   * `definition.default_name` is what names an install — but it is part of the
   * listing shape this document is in.
   */
  name?: string;
  /** What the app declares it can do. */
  definition: Manifest;
}

/**
 * The document to serve at {@link MANIFEST_PATH}.
 *
 * Serialize the result once and serve the same bytes every time: a deployment
 * hashes what it fetches and re-checks it hourly, so a rendering that differs
 * run to run flips the registration back to needing re-verification for no
 * reason. Put nothing per-request or per-release in it — no version, no
 * timestamp, no host.
 */
export function appDocument(
  manifest: Manifest,
  options: { uid?: string; name?: string } = {}
): AppDocument {
  return {
    protocol_version: manifest.service?.protocol ?? APP_PROTOCOL_VERSION,
    public_id: manifest.service?.public_id,
    kind: APP_KIND,
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
  if (body.kind !== APP_KIND) {
    problems.push({ where: "/kind", message: `must be '${APP_KIND}'` });
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

/** Which manifest block backs each declared feature. */
export const FEATURE_BLOCKS: Record<Feature, keyof Manifest> = {
  widgets: "widgets",
  embeds: "embeds",
  endpoints: "endpoints",
};

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
  return [...featureProblems(body), ...referenceProblems(body)];
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
    checkRequires(endpoint.requires, `${where}/requires`);
  });

  (body.embeds ?? []).forEach((embed, index) =>
    checkRequires(embed.requires, `/embeds/${index}/requires`)
  );
  (body.widgets ?? []).forEach((widget, index) => {
    checkRequires(widget.requires, `/widgets/${index}/requires`);
    for (const id of widget.endpoints ?? []) {
      // A widget draws what it is given, so it can only bind something that
      // answers. Binding a write or an emit would declare a tile nothing fills.
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
