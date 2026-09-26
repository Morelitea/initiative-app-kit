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

export type RevokeMethod = "hook" | "rfc7009";
export const REVOKE_METHODS: readonly RevokeMethod[] = ["hook", "rfc7009"];

export type JwtAlgorithm = "ES256" | "RS256";
export const JWT_ALGORITHMS: readonly JwtAlgorithm[] = ["ES256", "RS256"];

export type FieldType = "bool" | "int" | "secret" | "select" | "string" | "url";
export const FIELD_TYPES: readonly FieldType[] = ["bool", "int", "secret", "select", "string", "url"];

export type VendorFieldType = "secret" | "string" | "url";
export const VENDOR_FIELD_TYPES: readonly VendorFieldType[] = ["secret", "string", "url"];

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

export type Scope = "projects:read" | "projects:write" | "documents:read" | "documents:write" | "queues:read" | "queues:write" | "counter_groups:read" | "counter_groups:write" | "calendars:read" | "calendars:write" | "dashboards:read" | "dashboards:write" | "posts:read" | "posts:write" | "galleries:read" | "galleries:write" | "wikis:read" | "wikis:write" | "comments:read" | "comments:write" | "relationships:read" | "relationships:write" | "tags:read" | "tags:write" | "sharing:read" | "sharing:write" | "members:read" | "initiatives:read";
export const SCOPES: readonly Scope[] = ["projects:read", "projects:write", "documents:read", "documents:write", "queues:read", "queues:write", "counter_groups:read", "counter_groups:write", "calendars:read", "calendars:write", "dashboards:read", "dashboards:write", "posts:read", "posts:write", "galleries:read", "galleries:write", "wikis:read", "wikis:write", "comments:read", "comments:write", "relationships:read", "relationships:write", "tags:read", "tags:write", "sharing:read", "sharing:write", "members:read", "initiatives:read"];

export type SurfaceScope = "guild" | "initiative";
export const SURFACE_SCOPES: readonly SurfaceScope[] = ["guild", "initiative"];

export type EmbedCapability = "camera" | "clipboard-read" | "clipboard-write" | "display-capture" | "fullscreen" | "geolocation" | "microphone";
export const EMBED_CAPABILITIES: readonly EmbedCapability[] = ["camera", "clipboard-read", "clipboard-write", "display-capture", "fullscreen", "geolocation", "microphone"];

export type ListingKind = "app" | "dashboard";
export const LISTING_KINDS: readonly ListingKind[] = ["app", "dashboard"];

/** Every cap the platform enforces, by the name the contract gives it. */
export const CAPS = {
  connections: 20,
  fieldsPerConnection: 12,
  vendorFields: 12,
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
  vendor: ["label", "fields"],
  vendorField: ["key", "type", "required", "label"],
  endpointParam: ["key", "type", "required", "label", "options", "options_from", "list"],
  endpointReturn: ["key", "type", "label", "list"],
  connection: ["id", "scope", "label", "fields", "flow", "token", "access_hint"],
  connectionFlow: ["type", "authorize_url", "token_url", "client_id", "client_secret", "scopes", "pkce", "authorize_params", "install_url", "after_connect", "revoke", "revoke_url"],
  connectionToken: ["type", "exchange_url", "iss", "key", "alg", "lifetime"],
  webhooks: ["verify", "dedup", "route"],
  webhookVerify: ["scheme", "header", "prefix", "encoding", "secret"],
  webhookRoute: ["path", "connection", "field"],
  schedule: ["id", "every"],
  endpoint: ["id", "label", "description", "returns", "group", "needs_subject", "direction", "params", "actors", "admin_only", "public", "requires", "cache_ttl_seconds", "identity"],
  widget: ["id", "meta", "module_source", "endpoints", "sample_data", "requires"],
  embed: ["id", "path", "name", "scopes", "admin_only", "capabilities", "requires"],
  bundledDashboard: ["uid", "public_id", "name", "description", "layout", "widgets"],
  bundledDashboardWidget: ["id", "type", "title", "grid", "binding"],
  endpointIdentity: ["kind", "key"],
  manifest: ["app_kind", "service", "features", "default_name", "vendor", "connections", "webhooks", "schedules", "endpoints", "guild_summary", "widgets", "embeds", "dashboards"],
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
 * values are entered on the deployment and referenced from a connection's flow
 * or token as '{vendor.<key>}'.
 */
export interface Vendor {
  /**
   * What the vendor client is called, for the operator's form.
   */
  label?: LocalizedText;
  fields: VendorField[];
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
   * Who the credential belongs to. 'static' is one credential the whole guild
   * uses; 'interactive' is each member's own account at a vendor that
   * authorizes people. It does not say how the credential is obtained: a static
   * connection with a 'flow' is still one credential for the whole guild, run
   * by an admin through the vendor's own pages rather than typed into a form.
   * An interactive connection always declares a 'flow'.
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
   * Call the app's after_connect hook with the fresh access token once the code
   * is exchanged. It returns the connection's managed values and an account
   * label, or refuses.
   */
  after_connect?: boolean;
  /**
   * How a grant is ended at the vendor when the connection ends: 'rfc7009'
   * posts to 'revoke_url' with the client's credentials, 'hook' calls the app's
   * revoke hook with the tokens. Absent: the tokens are deleted and nothing is
   * sent.
   */
  revoke?: RevokeMethod;
  /**
   * The vendor's revocation endpoint (RFC 7009). Required when 'revoke' is
   * 'rfc7009'. May name a vendor value as '{vendor.<key>}' and one of this
   * connection's own fields as '{<key>}'.
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
 * app's webhook hook once for each.
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
 * Which communities a delivery belongs to: a value in its body, matched against
 * one field of a static connection as each community's connect stored it.
 */
export interface WebhookRoute {
  /**
   * Where the value is in the JSON body, as keys joined by '.', such as
   * 'installation.id'.
   */
  path: string;
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
   * Where the surface renders. Declaring both gives it a guild-wide entry and
   * an entry inside each initiative.
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
 * What a service app declares it can do. This is the 'definition' field of the
 * document served at /.well-known/initiative-app.json, NOT that whole document:
 * a registrar also requires protocol_version, public_id and kind alongside it,
 * and refuses a definition served bare. Generated from the platform's own
 * validator vocabulary. A manifest that satisfies this schema is well-formed,
 * not necessarily acceptable. Cross-references (the endpoint a widget binds, a
 * requires term's connection, an endpoint's service prefix), the
 * direction-specific rules on an endpoint, the features/blocks cross-check in
 * both directions, UTF-8 byte-size caps, the rules tying a connection's flow
 * and token to its scope and fields, what a webhooks block names, and the
 * bounds and unique ids of schedules are enforced by the platform on publish
 * and are not expressible here.
 */
export interface Manifest {
  /**
   * The only kind that names a container to call.
   */
  app_kind: "service";
  service: {
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
   * A read endpoint whose declared returns describe this guild's standing with
   * your service — what it has used, what it is allowed. A deployment may
   * render them on the guild's own settings page, beside its own figures.
   * Whether it does is the deployment's decision and not this manifest's: an
   * app the operator did not ship is declaring where it would like to appear,
   * which is not the same as appearing.
   */
  guild_summary?: NamespacedId;
  widgets?: Widget[];
  embeds?: Embed[];
  /**
   * Ready-made arrangements of this app's own widgets. Publishing the app
   * publishes one ordinary dashboard listing per entry, offered to guilds that
   * install the app.
   */
  dashboards?: BundledDashboard[];
}