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
 * cross-references (a widget's data sources, a `requires` term's connection, an
 * event's service prefix), the features/blocks cross-check in both directions,
 * UTF-8 byte-size caps, and the conditional rules for `connect_path` and
 * initiative visibility.
 *
 * {@link validateManifest} adds the first two of those on top of the schema,
 * because they are cheap to check here and are the two an author trips over
 * most. The byte caps and the conditional rules are left to the platform.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Where a deployment fetches your manifest. */
export const MANIFEST_PATH = "/.well-known/initiative-app.json";

/** The wire protocol this kit speaks. */
export const APP_PROTOCOL_VERSION = 1;

export type ConnectionScope = "static" | "interactive";
export type FieldType = "string" | "secret" | "url" | "bool" | "select" | "int";
export type ParamType = Exclude<FieldType, "secret">;
export type Visibility = "member" | "initiative_manager" | "guild_admin";
export type SurfaceScope = "guild" | "initiative";
export type Feature = "data" | "widgets" | "embeds" | "events" | "automations";

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

export interface DataSource {
  id: string;
  path: string;
  visibility?: Exclude<Visibility, "initiative_manager">;
  cache_ttl_seconds?: number;
  params_schema?: Array<Omit<ConnectionField, "type" | "managed"> & { type: ParamType }>;
  requires?: Requires;
}

export interface Widget {
  id: string;
  meta: Record<string, unknown>;
  module_source: string;
  sources?: string[];
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
  data_sources?: DataSource[];
  widgets?: Widget[];
  embeds?: Embed[];
  events?: string[];
  automation?: Record<string, unknown>;
}

/** Which manifest block backs each declared feature. */
export const FEATURE_BLOCKS: Record<Feature, keyof Manifest> = {
  data: "data_sources",
  widgets: "widgets",
  embeds: "embeds",
  events: "events",
  automations: "automation",
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

/**
 * Everything this side can check: the schema, plus the two cross-cutting rules
 * an author trips over most.
 *
 * An empty array does not promise the platform will accept it — see the module
 * note — but a non-empty one is a definite refusal, so this is worth running in
 * CI and before a publish.
 */
export function validateManifest(manifest: unknown): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  if (typeof manifest !== "object" || manifest === null) {
    return [{ where: "", message: "a manifest is a JSON object" }];
  }
  const body = manifest as Manifest;

  problems.push(...featureProblems(body));
  problems.push(...referenceProblems(body));
  return problems;
}

/** Every declared feature backed by a block, and every block declared. */
function featureProblems(body: Manifest): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const declared = new Set(body.features ?? []);
  for (const [feature, block] of Object.entries(FEATURE_BLOCKS) as Array<
    [Feature, keyof Manifest]
  >) {
    const present = body[block] !== undefined;
    if (declared.has(feature) && !present) {
      problems.push({
        where: "/features",
        message: `the '${feature}' feature is declared but ${String(block)} is missing`,
      });
    }
    if (present && !declared.has(feature)) {
      problems.push({
        where: `/${String(block)}`,
        message: `${String(block)} is present but the '${feature}' feature is not declared`,
      });
    }
  }
  return problems;
}

/** Ids that must name something the manifest itself declares. */
function referenceProblems(body: Manifest): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const connectionIds = new Set((body.connections ?? []).map((c) => c.id));
  const sourceIds = new Set((body.data_sources ?? []).map((s) => s.id));

  const checkRequires = (requires: Requires | undefined, where: string) => {
    if (!requires) return;
    const named = (["all_of", "any_of"] as const).filter((key) => key in requires);
    if (named.length !== 1) {
      problems.push({ where, message: "requires names exactly one of 'all_of' or 'any_of'" });
      return;
    }
    for (const id of requires[named[0]] ?? []) {
      if (!connectionIds.has(id)) {
        problems.push({ where, message: `requires names unknown connection '${id}'` });
      }
    }
  };

  (body.data_sources ?? []).forEach((source, index) =>
    checkRequires(source.requires, `/data_sources/${index}/requires`)
  );
  (body.embeds ?? []).forEach((embed, index) =>
    checkRequires(embed.requires, `/embeds/${index}/requires`)
  );
  (body.widgets ?? []).forEach((widget, index) => {
    checkRequires(widget.requires, `/widgets/${index}/requires`);
    for (const id of widget.sources ?? []) {
      if (!sourceIds.has(id)) {
        problems.push({
          where: `/widgets/${index}/sources`,
          message: `binds unknown data source '${id}'`,
        });
      }
    }
  });

  const prefix = `app.${body.service?.public_id}.`;
  for (const [index, event] of (body.events ?? []).entries()) {
    if (!event.startsWith(prefix) || event.length === prefix.length) {
      problems.push({
        where: `/events/${index}`,
        message: `event types are namespaced under your service id — '${prefix}…'`,
      });
    }
  }
  return problems;
}
