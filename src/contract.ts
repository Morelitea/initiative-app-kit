/**
 * The app contract, as TypeScript.
 *
 * GENERATED from `manifest.contract.json` by `scripts/generate.mjs`. Do not
 * edit it: change the contract and run `npm run generate`.
 *
 * These are the enums, caps and character sets the bundled JSON Schema is built
 * from, and the shape of every object it defines, so this package's types
 * cannot describe a manifest the schema refuses, nor miss a term it allows.
 */

export type Feature = "dashboards" | "embeds" | "endpoints" | "widgets";
export const FEATURES: readonly Feature[] = ["dashboards", "embeds", "endpoints", "widgets"];

export type Protocol = 1;
export const PROTOCOLS: readonly Protocol[] = [1];

export type ConnectionScope = "interactive" | "static";
export const CONNECTION_SCOPES: readonly ConnectionScope[] = ["interactive", "static"];

export type FlowType = "oauth2";
export const FLOW_TYPES: readonly FlowType[] = ["oauth2"];

export type TokenType = "jwt_bearer";
export const TOKEN_TYPES: readonly TokenType[] = ["jwt_bearer"];

export type RevokeMethod = "github_grant" | "hook" | "rfc7009";
export const REVOKE_METHODS: readonly RevokeMethod[] = ["github_grant", "hook", "rfc7009"];

export type JwtAlgorithm = "ES256" | "RS256";
export const JWT_ALGORITHMS: readonly JwtAlgorithm[] = ["ES256", "RS256"];

export type FieldType = "bool" | "int" | "secret" | "select" | "string" | "url";
export const FIELD_TYPES: readonly FieldType[] = ["bool", "int", "secret", "select", "string", "url"];

export type VendorFieldType = "secret" | "string" | "url";
export const VENDOR_FIELD_TYPES: readonly VendorFieldType[] = ["secret", "string", "url"];

export type GithubPermissionLevel = "read" | "write";
export const GITHUB_PERMISSION_LEVELS: readonly GithubPermissionLevel[] = ["read", "write"];

export type GithubAppValue = "client_id" | "client_secret" | "id" | "pem" | "slug" | "webhook_secret";
export const GITHUB_APP_VALUES: readonly GithubAppValue[] = ["client_id", "client_secret", "id", "pem", "slug", "webhook_secret"];

export type WebhookScheme = "hmac_sha1" | "hmac_sha256";
export const WEBHOOK_SCHEMES: readonly WebhookScheme[] = ["hmac_sha1", "hmac_sha256"];

export type WebhookEncoding = "base64" | "hex";
export const WEBHOOK_ENCODINGS: readonly WebhookEncoding[] = ["base64", "hex"];

export type ParamType = "bool" | "datetime" | "int" | "select" | "string" | "url";
export const PARAM_TYPES: readonly ParamType[] = ["bool", "datetime", "int", "select", "string", "url"];

export type ReturnValueType = "bool" | "datetime" | "int" | "string" | "url";
export const RETURN_VALUE_TYPES: readonly ReturnValueType[] = ["bool", "datetime", "int", "string", "url"];

export type Direction = "emit" | "read" | "write";
export const DIRECTIONS: readonly Direction[] = ["emit", "read", "write"];

export type ActorKind = "installation" | "member";
export const ACTOR_KINDS: readonly ActorKind[] = ["installation", "member"];

export type Scope = "projects:read" | "projects:write" | "documents:read" | "documents:write" | "queues:read" | "queues:write" | "counter_groups:read" | "counter_groups:write" | "calendars:read" | "calendars:write" | "dashboards:read" | "dashboards:write" | "posts:read" | "posts:write" | "galleries:read" | "galleries:write" | "wikis:read" | "wikis:write" | "comments:read" | "comments:write" | "relationships:read" | "relationships:write" | "tags:read" | "tags:write" | "sharing:read" | "sharing:write" | "members:read" | "initiatives:read" | "initiatives:moderate" | "community:admin";
export const SCOPES: readonly Scope[] = ["projects:read", "projects:write", "documents:read", "documents:write", "queues:read", "queues:write", "counter_groups:read", "counter_groups:write", "calendars:read", "calendars:write", "dashboards:read", "dashboards:write", "posts:read", "posts:write", "galleries:read", "galleries:write", "wikis:read", "wikis:write", "comments:read", "comments:write", "relationships:read", "relationships:write", "tags:read", "tags:write", "sharing:read", "sharing:write", "members:read", "initiatives:read", "initiatives:moderate", "community:admin"];

export type SurfaceScope = "community" | "initiative";
export const SURFACE_SCOPES: readonly SurfaceScope[] = ["community", "initiative"];

export type EmbedCapability = "camera" | "clipboard-read" | "clipboard-write" | "display-capture" | "fullscreen" | "geolocation" | "microphone";
export const EMBED_CAPABILITIES: readonly EmbedCapability[] = ["camera", "clipboard-read", "clipboard-write", "display-capture", "fullscreen", "geolocation", "microphone"];

export type ListingKind = "app" | "dashboard";
export const LISTING_KINDS: readonly ListingKind[] = ["app", "dashboard"];

export type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
export const HTTP_METHODS: readonly HttpMethod[] = ["DELETE", "GET", "PATCH", "POST", "PUT"];

export type PageLimit = "refuse" | "truncate";
export const PAGE_LIMITS: readonly PageLimit[] = ["refuse", "truncate"];

export type StatusRange = "2xx" | "3xx" | "4xx" | "5xx";
export const STATUS_RANGES: readonly StatusRange[] = ["2xx", "3xx", "4xx", "5xx"];

export type ConnectionState = "ok" | "removed" | "suspended" | "unavailable";
export const CONNECTION_STATES: readonly ConnectionState[] = ["ok", "removed", "suspended", "unavailable"];

export type PlatformCode = "invalid" | "mapping-failed" | "not-authorized" | "not-found" | "range-too-large";
export const PLATFORM_CODES: readonly PlatformCode[] = ["invalid", "mapping-failed", "not-authorized", "not-found", "range-too-large"];

/** Every cap the platform enforces, by the name the contract gives it. */
export const CAPS = {
  connections: 20,
  fieldsPerConnection: 12,
  vendorFields: 12,
  githubAppPermissions: 100,
  githubAppEvents: 100,
  flowScopes: 24,
  authorizeParams: 12,
  tokenLifetimeSeconds: 600,
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
  appScopes: 24,
  schedules: 8,
  scheduleMinMinutes: 5,
  scheduleMaxMinutes: 1440,
  scheduleEveryLength: 5,
  hosts: 8,
  hostLength: 253,
  steps: 3,
  pages: 10,
  perPage: 100,
  requestQuery: 24,
  requestHeaders: 12,
  errorRules: 12,
  unavailableCodes: 12,
  webhookEvents: 32,
  webhookStatuses: 12,
  healthStates: 12,
  statusCode: 599,
  expressionLength: 16384,
  graphqlLength: 16384,
  expressionTimeMs: 1000,
  expressionDepth: 500,
  expressionOutputBytes: 1048576,
} as const;

/** The character sets ids and paths are drawn from. */
export const CHARSETS = {
  identifier: "-0123456789_abcdefghijklmnopqrstuvwxyz",
  namespacedId: "-.0123456789_abcdefghijklmnopqrstuvwxyz",
  publicId: "-.0123456789_abcdefghijklmnopqrstuvwxyz",
  uid: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
  path: "-./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz",
  headerName: "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  fieldPath: "-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz",
  localeTag: "-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  version: "0123456789.-+abcdefghijklmnopqrstuvwxyz",
  artwork: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/._-",
  queryName: "-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ[]_abcdefghijklmnopqrstuvwxyz~",
} as const;

/**
 * Every field the contract declares, by the object that owns it.
 *
 * The inventory the platform holds its normalizer to, exported so a consumer
 * can enumerate what a manifest may carry without parsing the schema.
 */
export const FIELDS = {
  requires: ["all_of", "any_of"],
  accessHint: ["api", "scopes"],
  connectionField: ["key", "type", "required", "label", "options", "managed"],
  vendor: ["label", "fields", "setup"],
  vendorField: ["key", "type", "required", "label"],
  githubAppManifestSetup: ["kind", "app", "values"],
  githubAppManifest: ["name", "url", "public", "default_permissions", "default_events"],
  endpointParam: ["key", "type", "required", "label", "options", "options_from", "list"],
  endpointReturn: ["key", "type", "label", "list"],
  connection: ["id", "scope", "label", "fields", "flow", "token", "access_hint", "health"],
  connectionFlow: ["type", "authorize_url", "token_url", "client_id", "client_secret", "scopes", "pkce", "authorize_params", "install_url", "after_connect", "revoke", "revoke_url"],
  connectionToken: ["type", "exchange_url", "iss", "key", "alg", "lifetime"],
  webhooks: ["verify", "dedup", "route", "events", "status"],
  webhookVerify: ["scheme", "header", "prefix", "encoding", "secret"],
  webhookRoute: ["path", "header", "connection", "field"],
  schedule: ["id", "every"],
  endpoint: ["id", "label", "description", "returns", "group", "needs_subject", "direction", "params", "actors", "admin_only", "public", "requires", "cache_ttl_seconds", "identity", "unavailable", "request", "steps", "map", "errors"],
  widget: ["id", "meta", "module_source", "endpoints", "sample_data", "requires"],
  embed: ["id", "path", "name", "scopes", "admin_only", "capabilities", "requires"],
  bundledDashboard: ["uid", "public_id", "name", "description", "layout", "widgets"],
  bundledDashboardWidget: ["id", "type", "title", "grid", "binding"],
  endpointIdentity: ["kind", "key"],
  vendorAuth: ["header", "prefix"],
  vendorRequest: ["method", "url", "query", "headers", "body", "graphql", "connection", "paging"],
  graphqlRequest: ["query", "variables"],
  requestStep: ["name", "request"],
  pageNumberPaging: ["kind", "page_param", "per_page_param", "per_page", "items", "max_pages", "on_limit"],
  linkHeaderPaging: ["kind", "items", "max_pages", "on_limit"],
  cursorPaging: ["kind", "next", "more", "param", "variable", "items", "max_pages", "on_limit"],
  errorRule: ["status", "when", "code"],
  afterConnect: ["request", "steps", "map", "refuse_when", "code"],
  connectionHealth: ["request", "every", "states"],
  healthState: ["status", "when", "state"],
  webhookEvent: ["when", "emit", "map"],
  webhookStatus: ["when", "connection", "state"],
  manifest: ["app_kind", "service", "features", "default_name", "hosts", "auth", "vendor", "connections", "webhooks", "schedules", "endpoints", "community_summary", "widgets", "embeds", "dashboards"],
} as const;

export type Identifier = string;

/**
 * A route on the app's own service, never an address. The deployment joins it
 * to the base URL its registration supplies.
 */
export type Path = string;

/**
 * Localized text, keyed by language tag. At least one usable entry; the
 * platform falls back to the reader's language, then to any entry. Values
 * should be strings: text longer than 120 characters is truncated, and an entry
 * that is not a string, is not a language tag, or falls past the first 40 is
 * ignored rather than refused.
 */
export type LocalizedText = Record<string, string>;

/**
 * Connection ids that must hold a value before this is offered. Exactly one of
 * 'all_of' or 'any_of'; each id must name a connection this manifest declares.
 * Absent means always available.
 */
export interface Requires {
  all_of?: Identifier[];
  any_of?: Identifier[];
}

/**
 * What the credential will be used for. Display-only: it is shown beside the
 * form so an admin can mint a minimal credential, and no other system's
 * permissions are enforced from it.
 */
export interface AccessHint {
  api?: string;
  scopes?: string[];
}

export interface ConnectionField {
  key: Identifier;
  type: FieldType;
  required?: boolean;
  label: LocalizedText;
  /**
   * Required when type is 'select'.
   */
  options?: string[];
  /**
   * Returned by the app's after_connect hook when a flow finishes; it is not
   * typed into the settings form.
   */
  managed?: boolean;
}

/**
 * What an operator supplies once per deployment for the vendor's own client:
 * its id, its secret, its signing key. Declared here and never valued here: the
 * values are entered on the deployment, or written there by the vendor's own
 * setup flow, and referenced from a connection's flow or token as
 * '{vendor.<key>}'.
 */
export interface Vendor {
  /**
   * What the vendor client is called, for the operator's form.
   */
  label?: LocalizedText;
  fields: VendorField[];
  /**
   * How the vendor's client can be made for a deployment by the vendor itself,
   * rather than registered by hand. Absent: the operator enters every value.
   */
  setup?: VendorSetup;
}

export interface VendorField {
  key: Identifier;
  /**
   * A 'secret' is written once and never shown again.
   */
  type: VendorFieldType;
  /**
   * The app is not live on a deployment until every required value is set.
   */
  required?: boolean;
  label: LocalizedText;
}

/**
 * A flow at the vendor that creates the vendor's client and answers with its
 * values. Initiative runs it from the operator's browser and writes what the
 * vendor answers into the deployment's vendor values, so none is typed or
 * copied. One member per flow, told apart by 'kind'.
 */
export type VendorSetup = GithubAppManifestSetup;

/**
 * A GitHub App created from a manifest (GitHub's app manifest flow). The
 * operator confirms it on GitHub, and Initiative exchanges the code GitHub
 * returns for the new app's values. Initiative fills in every address itself
 * (the callback, setup, webhook and redirect URLs), so the manifest names none.
 */
export interface GithubAppManifestSetup {
  kind: "github_app_manifest";
  app: GithubAppManifest;
  /**
   * Which vendor value each of GitHub's answers is written to: one of this
   * app's vendor field keys to one field of GitHub's manifest-conversion
   * response. Every key must be a field of the vendor block, each response
   * field is written at most once, and 'client_secret', 'pem' and
   * 'webhook_secret' are written only to a 'secret' field.
   */
  values: Record<string, GithubAppValue>;
}

/**
 * What GitHub is asked to create: the parts of a GitHub App manifest an app
 * decides.
 */
export interface GithubAppManifest {
  /**
   * The name GitHub offers for the new app. The operator may change it on
   * GitHub, where an app's name is unique.
   */
  name: string;
  /**
   * The app's homepage, https.
   */
  url: string;
  /**
   * Any GitHub account may install the new app. Absent: only the account that
   * owns it.
   */
  public?: boolean;
  /**
   * The permissions the app is created with, by GitHub's name for each, such as
   * 'issues'. At most 100.
   */
  default_permissions?: Record<string, GithubPermissionLevel>;
  /**
   * The webhook events the app subscribes to, by GitHub's name for each, such
   * as 'issues'. GitHub accepts an event only beside a permission that covers
   * it. At most 100.
   */
  default_events?: Identifier[];
}

export interface EndpointParam {
  key: Identifier;
  type: ParamType;
  required?: boolean;
  label: LocalizedText;
  /**
   * Required when type is 'select'. The values themselves — a consumer that
   * shows a menu writes its own words for them.
   */
  options?: string[];
  /**
   * Where this parameter's values come from when only the app can know them.
   * Names a read endpoint in THIS manifest and which of its returns holds the
   * values; a consumer building a form asks the deployment to resolve it rather
   * than showing a text box. For everything a manifest cannot list because the
   * answer differs per install and changes after it — a repository, a channel,
   * a board, a project. `options` is the other case: a set that is the same on
   * every deployment forever. Declaring values, not a control: what to draw is
   * still the consumer's. Resolution is server-side, inherits the source
   * endpoint's `requires` and `cache_ttl_seconds`, and a source that cannot be
   * resolved leaves the parameter enterable rather than unusable.
   */
  options_from?: {
    /**
     * A read endpoint this same manifest declares. Not another app's: reading
     * across apps has no consent story, and an id from elsewhere is refused on
     * publish.
     */
    endpoint: NamespacedId;
    /**
     * Which of that endpoint's returns holds the values. Must be one it
     * declares, and a list: a menu comes from a column of values, not from one.
     */
    key: Identifier;
    /**
     * Optional. A second return, parallel to `key`, holding what a person reads
     * — a board's title beside its opaque id. Absent means the value is its own
     * label.
     */
    label_key?: Identifier;
    /**
     * Optional. What to send that endpoint, written as one of ITS parameter
     * names to one of THIS endpoint's. A repository's labels, a board's fields,
     * a field's values — past the first source in a form, most of them answer
     * differently depending on what has been chosen already, and a source that
     * could not be told a sibling's answer could only ever offer the whole
     * account's worth. Every named sibling must be a parameter this endpoint
     * declares, and none of them this one. Until all of them have a value the
     * source is not called and the parameter stays enterable, exactly as for a
     * source that will not resolve.
     */
    needs?: Record<string, Identifier>;
  };
  /**
   * Several values rather than one. Cardinality is a fact about the value, so
   * it is yours; what to draw for it is the consumer's. Without it, an app
   * wanting several of something declares a string and documents a comma —
   * which nothing downstream can validate or complete.
   */
  list?: boolean;
}

export interface EndpointReturn {
  key: Identifier;
  /**
   * The parameter vocabulary minus 'select', because a select is a control and
   * the value behind one is a string.
   */
  type: ReturnValueType;
  label?: LocalizedText;
  /**
   * Several values rather than one. It matters to a consumer with somewhere to
   * put exactly one — a form field, a tile's number — which is why it is a flag
   * rather than a second set of types.
   */
  list?: boolean;
}

export interface Connection {
  id: Identifier;
  /**
   * Who the credential belongs to. 'static' is one credential the whole
   * community uses; 'interactive' is each member's own account at a vendor that
   * authorizes people. It does not say how the credential is obtained: a static
   * connection with a 'flow' is still one credential for the whole community,
   * run by an admin through the vendor's own pages rather than typed into a
   * form. An interactive connection always declares a 'flow'.
   */
  scope: ConnectionScope;
  label: LocalizedText;
  /**
   * Without a 'flow', what an admin types. With one, only the values the app's
   * after_connect hook returns, and every field is 'managed'. The tokens a flow
   * obtains are held apart from these, under reserved keys the app never
   * declares.
   */
  fields: ConnectionField[];
  /**
   * How the connection is established. Initiative runs it: the redirect, the
   * code exchange, refreshing and revoking. The app never holds the vendor
   * client's secret or a refresh token.
   */
  flow?: ConnectionFlow;
  /**
   * How a usable access token is got for this connection. Absent: the tokens
   * the flow stored, refreshed as needed. Static connections only.
   */
  token?: ConnectionToken;
  access_hint?: AccessHint;
  health?: ConnectionHealth;
}

/**
 * An OAuth 2.0 authorization code flow (RFC 6749 §4.1) that Initiative runs for
 * a connection, with the redirect addresses the deployment publishes.
 */
export interface ConnectionFlow {
  type: FlowType;
  /**
   * The vendor's authorization endpoint, https. May name a vendor value as
   * '{vendor.<key>}' and one of this connection's own fields as '{<key>}'.
   */
  authorize_url: string;
  /**
   * The vendor's token endpoint, https. May name a vendor value as
   * '{vendor.<key>}' and one of this connection's own fields as '{<key>}'.
   */
  token_url: string;
  /**
   * The vendor client's id, normally '{vendor.client_id}'. May name a vendor
   * value as '{vendor.<key>}' and one of this connection's own fields as
   * '{<key>}'.
   */
  client_id: string;
  /**
   * The vendor client's secret, normally '{vendor.client_secret}'. Absent for a
   * public client. May name a vendor value as '{vendor.<key>}' and one of this
   * connection's own fields as '{<key>}'.
   */
  client_secret?: string;
  /**
   * The vendor scopes asked for, sent space-separated.
   */
  scopes?: string[];
  /**
   * Send an S256 code challenge (RFC 7636).
   */
  pkce?: boolean;
  /**
   * Extra query parameters for the authorization request. May name a vendor
   * value as '{vendor.<key>}' and one of this connection's own fields as
   * '{<key>}'.
   */
  authorize_params?: Record<string, string>;
  /**
   * Static connections only. The vendor's install page, for a connection an
   * organization installs: the person installs first, the vendor returns to the
   * setup address with the installation's id, and one authorization trip
   * follows so the app can check who installed it. Requires 'after_connect'.
   * May name a vendor value as '{vendor.<key>}' and one of this connection's
   * own fields as '{<key>}'.
   */
  install_url?: string;
  /**
   * What runs once the code is exchanged, with the fresh access token, to learn
   * the connection's managed values and an account label, or to refuse it. A
   * container app sets true, and Initiative calls its after_connect hook; a
   * declarative app gives the call and its mapping.
   */
  after_connect?: boolean | AfterConnect;
  /**
   * How a grant is ended at the vendor when the connection ends: 'rfc7009'
   * posts to 'revoke_url' with the client's credentials; 'github_grant' sends
   * DELETE to 'revoke_url' (GitHub's 'Delete an app authorization') with the
   * client's credentials as HTTP Basic auth and the access token in the JSON
   * body as 'access_token'; 'hook' calls the app's revoke hook with the tokens,
   * so a container app's only. Absent: the tokens are deleted and nothing is
   * sent.
   */
  revoke?: RevokeMethod;
  /**
   * The vendor's revocation endpoint: RFC 7009's for 'rfc7009', or GitHub's
   * grant address
   * (https://api.github.com/applications/{vendor.client_id}/grant) for
   * 'github_grant'. Required when 'revoke' is either. May name a vendor value
   * as '{vendor.<key>}' and one of this connection's own fields as '{<key>}'.
   */
  revoke_url?: string;
}

/**
 * An access token minted on demand rather than stored: Initiative signs a JWT
 * with the vendor key and exchanges it, and caches the answer until shortly
 * before it expires.
 */
export interface ConnectionToken {
  type: TokenType;
  /**
   * Where the signed JWT is posted, https. The answer's 'token' (or
   * 'access_token') and 'expires_at' (or 'expires_in') are read. May name a
   * vendor value as '{vendor.<key>}' and one of this connection's own fields as
   * '{<key>}'.
   */
  exchange_url: string;
  /**
   * The JWT's issuer, normally '{vendor.app_id}'. May name a vendor value as
   * '{vendor.<key>}' and one of this connection's own fields as '{<key>}'.
   */
  iss: string;
  /**
   * The signing key, as a vendor value: '{vendor.private_key}'. A PEM private
   * key.
   */
  key: string;
  alg?: JwtAlgorithm;
  /**
   * How long the signed JWT lives, in seconds.
   */
  lifetime?: number;
}

/**
 * The vendor's webhooks, received by Initiative at one address per app on the
 * deployment, '/api/v1/app-hooks/<public_id>'. Initiative checks each
 * delivery's signature, drops one it has already delivered, finds the
 * communities it belongs to by a value in its body, and forwards it to the
 * app's webhook hook once for each. A container app's hook receives each
 * delivery; a declarative app maps it with 'events' and 'status' instead.
 */
export interface Webhooks {
  verify: WebhookVerify;
  /**
   * The header carrying the vendor's id for one delivery, such as
   * 'X-GitHub-Delivery'. A delivery with an id already forwarded to a community
   * is not forwarded to it again.
   */
  dedup: string;
  route: WebhookRoute;
  /**
   * Declarative apps: how a delivery becomes one of this app's events. The
   * first row whose 'when' holds emits; a delivery no row matches is dropped.
   */
  events?: WebhookEvent[];
  /**
   * Declarative apps: deliveries that say what state a connection is in at the
   * vendor. The first row whose 'when' holds sets it.
   */
  status?: WebhookStatus[];
}

/**
 * How a delivery's signature is checked: an HMAC over the raw body under a
 * vendor value.
 */
export interface WebhookVerify {
  scheme: WebhookScheme;
  /**
   * The header carrying the signature, such as 'X-Hub-Signature-256'.
   */
  header: string;
  /**
   * What precedes the signature in the header, such as 'sha256='. Absent:
   * nothing does.
   */
  prefix?: string;
  /**
   * How the signature is written.
   */
  encoding: WebhookEncoding;
  /**
   * The signing secret, as one vendor value: '{vendor.<key>}'.
   */
  secret: string;
}

/**
 * Which communities a delivery belongs to: a value in its body or in one of its
 * headers, matched against one field of a static connection as each community's
 * connect stored it. Exactly one of 'path' and 'header'.
 */
export interface WebhookRoute {
  /**
   * Where the value is in the JSON body, as keys joined by '.', such as
   * 'installation.id'.
   */
  path?: string;
  /**
   * The header carrying the value, such as 'X-Shopify-Shop-Domain'.
   */
  header?: string;
  /**
   * A static connection this app declares.
   */
  connection: Identifier;
  /**
   * A field that connection declares, whose stored value the body's value is
   * matched against.
   */
  field: Identifier;
}

/**
 * An interval at which Initiative calls the app's schedule hook, once for each
 * community that installed it, with when the call last succeeded there.
 */
export interface Schedule {
  /**
   * Unique within the manifest. The hook is told which schedule is due by it.
   */
  id: Identifier;
  /**
   * How often: a whole number of minutes ('15m') or hours ('6h'), at least 5
   * minutes and at most 1440 minutes.
   */
  every: string;
}

/**
 * Namespaced under the app's own service id — 'app.<public_id>.<name>'. The
 * prefix is checked against the declaring registration at ingress.
 */
export type NamespacedId = string;

/**
 * 'apps:<public_id>': permission to call another app's public endpoints through
 * the deployment, as this community or as one of its members. Not one of the
 * fixed scopes: the family is open, one per app, and the public id after the
 * prefix is the app being called. The deployment never lets an app address
 * another directly; the call goes through it, and the app called is handed its
 * own references for whoever the call is for.
 */
export type AppScope = `apps:${string}`;

export interface Endpoint {
  id: NamespacedId;
  /**
   * What this endpoint IS, in words somebody picks it out of a list by. Every
   * direction, and an emission most of all: it is the one thing here chosen
   * without ever being called.
   */
  label?: LocalizedText;
  /**
   * A second line, where the label needs one.
   */
  description?: LocalizedText;
  /**
   * What this hands back, by name and type — the response for a read or a
   * write, the payload for an emission. Declared rather than discovered,
   * because a consumer binds one of these before the endpoint has ever run and
   * a bad binding has to be refusable when somebody arranges it.
   */
  returns?: EndpointReturn[];
  /**
   * Where a consumer that groups an app's endpoints should file this one.
   * Opaque here: the grouping is the consumer's, and an endpoint that says
   * nothing sits in the flat list.
   */
  group?: Identifier;
  /**
   * What a caller must already have in hand for this to mean anything. Opaque
   * here — the vocabulary belongs to whoever consumes it; the automation
   * service names the subjects a run can be about.
   */
  needs_subject?: Identifier;
  /**
   * 'read' and 'write' are called through the deployment and answer in place;
   * 'emit' travels the other way — the app posts it to a subscriber that
   * registered a URL, so it carries no parameters and nothing to gate.
   */
  direction: Direction;
  /**
   * What a caller may send. Read and write only.
   */
  params?: EndpointParam[];
  /**
   * Whose credential the call runs on, best first. Read and write only. An
   * endpoint offering only 'member' refuses when that member has connected
   * nothing, rather than quietly acting as the app instead.
   */
  actors?: ActorKind[];
  /**
   * Only the community's admins read or call this endpoint — a figure for the
   * community's settings page, say. Anyone who can see where it is used may
   * otherwise.
   */
  admin_only?: boolean;
  /**
   * Read and write only. Other apps may call this endpoint through the
   * deployment, when the community has let them use this app ('apps:<your
   * public id>'). A caller acts as the community or as one of its members, and
   * `actors` says which of the two this endpoint takes: one that names neither
   * is not callable this way. A write endpoint is reachable only like this; a
   * widget binds reads alone. Absent means only the deployment's own surfaces
   * reach it.
   */
  public?: boolean;
  requires?: Requires;
  /**
   * Read only. How long a response may be reused. Clamped into 0..86400 rather
   * than refused, so a value outside that range is accepted and takes effect at
   * the bound — which is why no range is asserted here.
   */
  cache_ttl_seconds?: number;
  /**
   * 'write' and 'emit': what this touched, or what it is about. Read endpoints
   * have none — they touched nothing, so there is no echo to suppress.
   */
  identity?: EndpointIdentity;
  /**
   * Read and write only. The codes this endpoint may answer 'unavailable' with
   * beyond Initiative's own (invalid, mapping-failed, not-authorized,
   * not-found, range-too-large), so a consumer can put each into words.
   */
  unavailable?: Identifier[];
  /**
   * Declarative apps: the one call that answers this endpoint. Not beside
   * 'steps'.
   */
  request?: VendorRequest;
  /**
   * Declarative apps: up to 3 calls made in order, each able to read the
   * answers of the ones before it. Not beside 'request'.
   */
  steps?: RequestStep[];
  /**
   * Declarative apps: the endpoint's answer, from 'response' (the last call's
   * answer) and 'steps': an object of its declared returns, or {"unavailable":
   * "<code>"} naming one of its codes.
   */
  map?: Expression;
  /**
   * Declarative apps: vendor answers this endpoint gives its own meaning, tried
   * on every answer before the defaults. The defaults: 401 and 403 are
   * not-authorized, 404 not-found, 400, 422 and any other 4xx invalid, and 429,
   * 3xx and 5xx transient.
   */
  errors?: ErrorRule[];
}

export interface Widget {
  id: Identifier;
  /**
   * The widget's own name and description, as the picker shows them. Must name
   * the widget in at least one language.
   */
  meta: Record<string, unknown>;
  /**
   * The widget's browser-side module. Stored as an opaque string and executed
   * only inside the sandbox; the platform never parses it. Capped in UTF-8
   * bytes, which this schema cannot express.
   */
  module_source: string;
  /**
   * Read endpoint ids this manifest also declares. Only a read answers with
   * something to draw.
   */
  endpoints?: NamespacedId[];
  /**
   * What each endpoint would answer with, keyed by declared read endpoint id,
   * so a preview renders with no network call. Written in the endpoint's own
   * returns and read through them exactly as a live answer is. Keys naming an
   * undeclared endpoint are dropped.
   */
  sample_data?: Record<string, unknown>;
  requires?: Requires;
}

export interface Embed {
  id: Identifier;
  path: Path;
  name: LocalizedText;
  /**
   * Where the surface renders. Declaring both gives it a community-wide entry
   * and an entry inside each initiative.
   */
  scopes?: SurfaceScope[];
  /**
   * Only the community's admins open this surface, whatever roles a placement
   * allows — a settings page, say. Who else may open a surface is chosen in the
   * community, per initiative and per role, not declared here.
   */
  admin_only?: boolean;
  /**
   * Browser features the frame is granted. A surface that names nothing is
   * framed with all of them denied.
   */
  capabilities?: EmbedCapability[];
  requires?: Requires;
}

export interface BundledDashboard {
  /**
   * This dashboard's own catalog id — publisher-assigned, immutable, never
   * reused. It becomes a listing of its own, so this is a real catalog identity
   * and not the app's.
   */
  uid: string;
  /**
   * '<publisher>.<slug>', and not the app's own — a bundled dashboard is a
   * separate listing.
   */
  public_id: string;
  name: string;
  description?: string;
  layout?: {
    columns?: number;
  };
  widgets: BundledDashboardWidget[];
}

export interface BundledDashboardWidget {
  id?: Identifier;
  /**
   * One of this manifest's own widget ids — bare, with no uid. The platform
   * stamps the app's uid on when it publishes, so the two can never disagree.
   */
  type: Identifier;
  title?: string;
  grid?: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  };
  binding: {
    /**
     * One of this manifest's own read endpoint ids. Only a read answers with
     * something to draw.
     */
    endpoint_id: NamespacedId;
    params?: Record<string, string | number | boolean>;
  };
}

/**
 * Which of this endpoint's returns identify the thing it touched. A consumer
 * keeps a change an automation made from firing that automation again, and for
 * an app there was no key — so guessing would silently drop a fire somebody was
 * waiting on, and a rate cap was the only guard. Declare the SAME kind and key
 * on the write and on the emission about it, and the two produce the same
 * address.
 */
export interface EndpointIdentity {
  /**
   * Your own word for what sort of thing this is ('issue'). Namespaced by your
   * public id downstream, because two apps declaring the same kind mean two
   * different things.
   */
  kind: Identifier;
  /**
   * Returns of this endpoint, in order, joined to form the address. Every one
   * must be a single value rather than a list — half an address matches
   * nothing, and one built from the parts that happened to be there matches the
   * wrong thing.
   */
  key: Identifier[];
}

/**
 * A JSONata expression (https://jsonata.org): standard JSONata, with no
 * functions added. It reads one document. On the way out that holds 'params',
 * the call's parameters as the caller sent them; 'connection', the non-secret
 * fields of the connection the request names; 'connections', on an endpoint's
 * requests and map, each connection its 'requires' names that the call has, by
 * its id, holding the same fields; 'now', the time of the call in ISO 8601,
 * which $now() and $millis() also answer; and 'steps', each earlier step's
 * answer by its name. On the way back it also holds 'response', the answer
 * being read: {status, headers, body}, with header names in lowercase. Each
 * evaluation is bounded: at most 1000 milliseconds, 500 levels of nesting and
 * an answer of 1048576 bytes as JSON. An expression that fails or passes a
 * bound answers 'unavailable: mapping-failed'.
 */
export type Expression = string;

/**
 * A host a declarative app calls, in lowercase: exact ('api.github.com'), or
 * with one leading '*.' that stands for exactly one label ('*.myshopify.com').
 * No scheme, port or path: every call is https on port 443, and goes only to a
 * public address.
 */
export type Host = string;

export type HeaderName = string;

export type QueryName = string;

/**
 * How Initiative puts a connection's credential on a declarative app's
 * requests: one header, holding the prefix and the token joined by a space.
 * Absent: 'Authorization: Bearer <token>'.
 */
export interface VendorAuth {
  header?: HeaderName;
  /**
   * Written before the token. Empty: the token alone.
   */
  prefix?: string;
}

/**
 * One call Initiative makes to the vendor for a declarative app, rendered from
 * expressions. Initiative adds the credential itself, as 'auth' says, and
 * follows no redirect.
 */
export interface VendorRequest {
  method: HttpMethod;
  /**
   * The address, as an expression answering a string: https, on one of the
   * app's hosts. Query parameters may be written into it or given in 'query'.
   */
  url: Expression;
  /**
   * Query parameters by name, each an expression. One answering null or nothing
   * is left out, and a list repeats the parameter once per value.
   */
  query?: Record<string, Expression>;
  /**
   * Headers by name, each an expression answering a string; one answering null
   * or nothing is left out. Never the credential's header, which Initiative
   * sets.
   */
  headers?: Record<string, Expression>;
  /**
   * The JSON body, as an expression. Not beside 'graphql'.
   */
  body?: Expression;
  graphql?: GraphqlRequest;
  /**
   * Which connection's credential the request carries: a static connection's is
   * the community's, an interactive one's the acting member's. A call made as a
   * member carries a static connection's credential only when the endpoint's
   * 'requires' names that connection, and is refused otherwise. Required on an
   * endpoint's requests. Absent on 'after_connect' and 'health', which carry
   * the credential of the connection they belong to.
   */
  connection?: Identifier;
  paging?: Paging;
}

/**
 * A GraphQL request, sent by POST as the JSON body {query, variables}.
 */
export interface GraphqlRequest {
  /**
   * The GraphQL document, as text. What varies goes in 'variables'.
   */
  query: string;
  /**
   * The variables, as an expression answering an object.
   */
  variables?: Expression;
}

export interface RequestStep {
  /**
   * Unique among its steps. Later steps, the map and the predicates beside it
   * read this step's answer as 'steps.<name>'.
   */
  name: Identifier;
  request: VendorRequest;
}

/**
 * How a request reads more than one page, one member per method, told apart by
 * 'kind'. Every page is read before the answer is mapped: 'response.body' is
 * then every page's items appended in order, and the status and headers are the
 * last page's. 'max_pages' is how many pages may be read; finding more after
 * that many truncates or refuses, as 'on_limit' says, and a refusal answers
 * 'unavailable: range-too-large'.
 */
export type Paging = PageNumberPaging | LinkHeaderPaging | CursorPaging;

/**
 * Numbered pages from 1, read until one holds fewer than 'per_page' items. Both
 * parameters are added to the request's query.
 */
export interface PageNumberPaging {
  kind: "page_number";
  /**
   * The parameter carrying the page number.
   */
  page_param: QueryName;
  /**
   * The parameter carrying 'per_page'. Absent: the vendor's page size is fixed,
   * and 'per_page' says what it is.
   */
  per_page_param?: QueryName;
  per_page: number;
  items?: PageItems;
  max_pages: MaxPages;
  on_limit: PageLimit;
}

/**
 * The address in the Link header's rel="next", followed until there is none. It
 * must be https on one of the app's hosts.
 */
export interface LinkHeaderPaging {
  kind: "link_header";
  items?: PageItems;
  max_pages: MaxPages;
  on_limit: PageLimit;
}

/**
 * A cursor read from each page and sent with the next, while 'more' holds.
 * Exactly one of 'param' and 'variable' says where it is sent.
 */
export interface CursorPaging {
  kind: "cursor";
  /**
   * The next page's cursor, from this page's 'response'.
   */
  next: Expression;
  /**
   * Whether there is a next page, from this page's 'response'.
   */
  more: Expression;
  /**
   * The query parameter the cursor is sent in.
   */
  param?: QueryName;
  /**
   * The GraphQL variable the cursor is sent in.
   */
  variable?: string;
  items?: PageItems;
  max_pages: MaxPages;
  on_limit: PageLimit;
}

/**
 * A page's items, from that page's 'response'. Absent: its body.
 */
export type PageItems = Expression;

export type MaxPages = number;

/**
 * An HTTP status: one code, or a range of a hundred ('4xx').
 */
export type StatusMatch = number | StatusRange;

/**
 * A vendor answer an endpoint gives its own meaning. Rules are tried in order
 * on every answer, a 2xx included, and the first that matches decides.
 */
export interface ErrorRule {
  status: StatusMatch;
  /**
   * Also required to hold, over the answer as 'response'. Absent: the status
   * alone matches.
   */
  when?: Expression;
  /**
   * What the call answers: one of the endpoint's 'unavailable' codes, one of
   * Initiative's own (invalid, mapping-failed, not-authorized, not-found,
   * range-too-large), or 'transient' for a passing failure such as a throttle,
   * which is answered as one to retry.
   */
  code: Identifier;
}

/**
 * A declarative app's after_connect: a request, or up to 3 steps, made with the
 * access token just obtained, and the answers mapped to what the hook would
 * answer. 'params' holds the flow's own parameters, such as the installation_id
 * an install page returned.
 */
export interface AfterConnect {
  /**
   * The one call. Not beside 'steps'.
   */
  request?: VendorRequest;
  /**
   * Up to 3 calls made in order, each able to read the answers of the ones
   * before it. Not beside 'request'.
   */
  steps?: RequestStep[];
  /**
   * The connection's managed values and its account label, from 'response' (the
   * last call's answer) and 'steps': {"values": {…}, "account_label": "…"}.
   */
  map: Expression;
  /**
   * Refuses the connection when it holds. It reads the map's answer as
   * 'result', beside 'response' and 'steps'.
   */
  refuse_when?: Expression;
  /**
   * What a refusal answers. Given exactly when 'refuse_when' is.
   */
  code?: Identifier;
}

/**
 * Declarative apps: a request Initiative makes on an interval, with this
 * connection's credential, to learn whether the connection still works. A state
 * other than 'ok' is reported once two answers in a row give it.
 */
export interface ConnectionHealth {
  request: VendorRequest;
  /**
   * How often: a whole number of minutes ('15m') or hours ('6h'), at least 5
   * minutes and at most 1440 minutes.
   */
  every: string;
  /**
   * Tried in order; the first that matches gives the state. An answer none
   * matches is 'ok' when it is 2xx and 'unavailable' otherwise.
   */
  states: HealthState[];
}

/**
 * The answers one row matches, and the state they mean. A row naming neither
 * 'status' nor 'when' matches any answer.
 */
export interface HealthState {
  status?: StatusMatch;
  /**
   * Also required to hold, over the answer as 'response'.
   */
  when?: Expression;
  state: ConnectionState;
}

/**
 * One way a delivery becomes an event. Its expressions read 'headers' (names in
 * lowercase), 'payload' (the parsed body), 'connection' (the routed
 * connection's non-secret fields) and 'now'.
 */
export interface WebhookEvent {
  /**
   * Whether this row applies.
   */
  when: Expression;
  /**
   * An emit endpoint this manifest declares.
   */
  emit: NamespacedId;
  /**
   * The event's payload: an object of that endpoint's declared returns.
   */
  map: Expression;
}

/**
 * A delivery that says what state a connection is in, read as an event's
 * expressions are.
 */
export interface WebhookStatus {
  /**
   * Whether this row applies.
   */
  when: Expression;
  /**
   * A connection this app declares.
   */
  connection: Identifier;
  /**
   * 'ok', 'suspended' or 'removed'.
   */
  state: ConnectionState;
}

/**
 * What an app declares it can do. An app is a container, which names its
 * `service` and answers Initiative's calls, or declarative, which names its
 * `hosts` and no service, and whose endpoints, connection checks and webhook
 * events Initiative runs itself from the requests and JSONata expressions
 * written here; one app is never both. This is the 'definition' field of the
 * document served at /.well-known/initiative-app.json, NOT that whole document:
 * a registrar also requires protocol_version, public_id and kind alongside it,
 * and refuses a definition served bare. Generated from the platform's own
 * validator vocabulary. A manifest that satisfies this schema is well-formed,
 * not necessarily acceptable. Cross-references (the endpoint a widget binds, a
 * requires term's connection, an endpoint's service prefix), the
 * direction-specific rules on an endpoint, the features/blocks cross-check in
 * both directions, UTF-8 byte-size caps, the rules tying a connection's flow
 * and token to its scope and fields, what a webhooks block names, what a vendor
 * setup writes to, whether every expression parses, what a declarative request
 * and its steps name, and the bounds and unique ids of schedules are enforced
 * by the platform on publish and are not expressible here.
 */
export interface Manifest {
  /**
   * The kind every app manifest has, container or declarative: a declarative
   * app is one with no 'service' block.
   */
  app_kind: "service";
  /**
   * A container app's service, which Initiative calls. Absent for a declarative
   * app, whose public id is its listing's.
   */
  service?: {
    /**
     * '<publisher>.<slug>'. The name the deployment's registration is matched
     * by, and the namespace this app's events are emitted under.
     */
    public_id: string;
    protocol?: Protocol;
    /**
     * The scopes this app asks a community to grant: what its installation and
     * member tokens act with. The fixed scopes, and 'apps:<public_id>' for each
     * app this one calls (at most 24 of those). The community grants some or
     * all of them when it installs the app, and a token never carries more than
     * was granted. Writing implies reading. Absent means none.
     */
    scopes?: Array<Scope | AppScope>;
  };
  /**
   * What this app contributes. Cross-checked against the blocks present in both
   * directions: a feature with no block, or a block with no feature, is
   * refused.
   */
  features: Feature[];
  default_name?: string;
  /**
   * Declarative apps, which must name at least one: every host their requests,
   * paging and links may reach. A container app names none.
   */
  hosts?: Host[];
  /**
   * Declarative apps only.
   */
  auth?: VendorAuth;
  vendor?: Vendor;
  connections?: Connection[];
  webhooks?: Webhooks;
  /**
   * What Initiative calls the app's schedule hook for, and how often. At most
   * 8.
   */
  schedules?: Schedule[];
  endpoints?: Endpoint[];
  /**
   * A read endpoint whose declared returns describe this community's standing
   * with your service — what it has used, what it is allowed. A deployment may
   * render them on the community's own settings page, beside its own figures.
   * Whether it does is the deployment's decision and not this manifest's: an
   * app the operator did not ship is declaring where it would like to appear,
   * which is not the same as appearing.
   */
  community_summary?: NamespacedId;
  widgets?: Widget[];
  embeds?: Embed[];
  /**
   * Ready-made arrangements of this app's own widgets. Publishing the app
   * publishes one ordinary dashboard listing per entry, offered to communities
   * that install the app.
   */
  dashboards?: BundledDashboard[];
}