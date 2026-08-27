/**
 * The app contract, as TypeScript.
 *
 * GENERATED from `manifest.contract.json` by `scripts/generate.mjs`. Do not
 * edit it: change the contract and run `npm run generate`.
 *
 * These are the enums, caps and character sets the bundled JSON Schema is built
 * from, so this package's types cannot describe a manifest the schema refuses,
 * nor miss one it allows.
 */

export type Feature = "dashboards" | "embeds" | "endpoints" | "widgets";
export const FEATURES: readonly Feature[] = ["dashboards", "embeds", "endpoints", "widgets"];

export type Protocol = 1;
export const PROTOCOLS: readonly Protocol[] = [1];

export type ConnectionScope = "interactive" | "static";
export const CONNECTION_SCOPES: readonly ConnectionScope[] = ["interactive", "static"];

export type FieldType = "bool" | "int" | "secret" | "select" | "string" | "url";
export const FIELD_TYPES: readonly FieldType[] = ["bool", "int", "secret", "select", "string", "url"];

export type ParamType = "bool" | "datetime" | "int" | "select" | "string" | "url";
export const PARAM_TYPES: readonly ParamType[] = ["bool", "datetime", "int", "select", "string", "url"];

export type ReturnValueType = "bool" | "datetime" | "int" | "string" | "url";
export const RETURN_VALUE_TYPES: readonly ReturnValueType[] = ["bool", "datetime", "int", "string", "url"];

export type Direction = "emit" | "read" | "write";
export const DIRECTIONS: readonly Direction[] = ["emit", "read", "write"];

export type ActorKind = "installation" | "member";
export const ACTOR_KINDS: readonly ActorKind[] = ["installation", "member"];

export type EndpointVisibility = "guild_admin" | "member";
export const ENDPOINT_VISIBILITIES: readonly EndpointVisibility[] = ["guild_admin", "member"];

export type Visibility = "guild_admin" | "initiative_manager" | "member";
export const VISIBILITIES: readonly Visibility[] = ["guild_admin", "initiative_manager", "member"];

export type SurfaceScope = "guild" | "initiative";
export const SURFACE_SCOPES: readonly SurfaceScope[] = ["guild", "initiative"];

export type EmbedCapability = "camera" | "clipboard-read" | "clipboard-write" | "display-capture" | "fullscreen" | "geolocation" | "microphone";
export const EMBED_CAPABILITIES: readonly EmbedCapability[] = ["camera", "clipboard-read", "clipboard-write", "display-capture", "fullscreen", "geolocation", "microphone"];

export type ListingKind = "app" | "dashboard";
export const LISTING_KINDS: readonly ListingKind[] = ["app", "dashboard"];

/** The visibility rungs, lowest first: a value names the floor an audience must clear. */
export const VISIBILITY_LADDER: readonly Visibility[] = ["member", "initiative_manager", "guild_admin"];

/** Every cap the platform enforces, by the name the contract gives it. */
export const CAPS = {
  connections: 20,
  fieldsPerConnection: 12,
  selectOptions: 24,
  accessHintScopes: 24,
  requiresTerms: 10,
  widgets: 12,
  widgetEndpoints: 8,
  endpoints: 64,
  paramsPerEndpoint: 12,
  returnsPerEndpoint: 24,
  embeds: 12,
  embedCapabilities: 8,
  bundledDashboards: 8,
  dashboardWidgets: 50,
  dashboardGridColumns: 12,
  dashboardBindingParams: 12,
  identifierLength: 64,
  publicIdLength: 120,
  pathLength: 200,
  endpointIdLength: 200,
  nameLength: 255,
  labelLength: 120,
  hintLength: 120,
  descriptionLength: 500,
  paramValueLength: 2000,
  uidLength: 14,
  textLength: 120,
  locales: 40,
  cacheTtlSeconds: 86400,
  moduleSourceBytes: 65536,
  sampleDataBytes: 32768,
  serviceDefinitionBytes: 524288,
  versionLength: 32,
  publisherNameLength: 120,
  urlLength: 300,
  localeTagLength: 12,
  widgetDescriptionLength: 400,
  widgetOptions: 12,
  valuesPerOption: 24,
  identityKeyParts: 4,
} as const;

/** The character sets ids and paths are drawn from. */
export const CHARSETS = {
  identifier: "-0123456789_abcdefghijklmnopqrstuvwxyz",
  namespacedId: "-.0123456789_abcdefghijklmnopqrstuvwxyz",
  publicId: "-.0123456789_abcdefghijklmnopqrstuvwxyz",
  uid: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
  path: "-./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz",
  localeTag: "-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  version: "0123456789.-+abcdefghijklmnopqrstuvwxyz",
  artwork: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/._-",
} as const;

/**
 * Every field the contract declares, by the object that owns it.
 *
 * The inventory the platform holds its normalizer to. Exported because a
 * consumer can then enumerate what a manifest may carry without parsing the
 * schema — and because a field that is here and nowhere else in this package
 * is a type this kit has not caught up with.
 */
export const FIELDS = {
  requires: ["all_of", "any_of"],
  accessHint: ["api", "scopes"],
  connectionField: ["key", "type", "required", "label", "options", "managed"],
  endpointParam: ["key", "type", "required", "label", "options", "list"],
  endpointReturn: ["key", "type", "label", "list"],
  connection: ["id", "scope", "label", "fields", "connect_path", "access_hint"],
  endpoint: ["id", "label", "description", "returns", "group", "needs_subject", "direction", "params", "actors", "requires", "cache_ttl_seconds", "visibility", "identity"],
  widget: ["id", "meta", "module_source", "endpoints", "sample_data", "requires"],
  embed: ["id", "path", "name", "scopes", "visibility", "capabilities", "requires"],
  bundledDashboard: ["uid", "public_id", "name", "description", "layout", "widgets"],
  bundledDashboardWidget: ["id", "type", "title", "grid", "binding"],
  endpointIdentity: ["kind", "key"],
  manifest: ["app_kind", "service", "features", "default_name", "connections", "endpoints", "widgets", "embeds", "dashboards"],
} as const;
