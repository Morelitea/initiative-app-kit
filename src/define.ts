/**
 * One typed definition of an app.
 *
 * {@link defineApp} takes everything an app declares and does: its endpoints
 * with their handlers, its hooks and schedules, its widgets and surfaces, and
 * its listing. The same object routes Initiative's calls (`createApp`) and
 * becomes the manifest (`initiative-app build`), so nothing is stated twice.
 *
 * {@link defineEndpoint} types one endpoint from its own declaration: its
 * `params` type the handler's arguments and its `returns` type what the
 * handler answers with.
 *
 * Endpoints are named by their key. The manifest id is `app.<publicId>.<key>`,
 * and everywhere a definition refers to an endpoint (a widget, a sample, a
 * parameter's `options_from`, a bundled dashboard, `guildSummary`) it uses the
 * key.
 */

import type {
  ActorKind,
  AppScope,
  BundledDashboard,
  BundledDashboardWidget,
  Connection,
  Embed,
  Endpoint,
  EndpointParam,
  EndpointReturn,
  Manifest,
  ReturnValueType,
  Scope,
  Vendor,
  Webhooks,
  Widget,
} from "./contract.js";
import { FEATURES } from "./contract.js";
import type { Client } from "./client.js";
import type { Jwks } from "./keys.js";

/**
 * What every handler is handed as `context`: the value given to `createApp`.
 *
 * Empty until an app says what it holds, by augmenting this interface:
 *
 * ```ts
 * declare module "initiative-app-sdk/manifest" {
 *   interface AppContext { tracker: TrackerClient }
 * }
 * ```
 */
export interface AppContext {}

/** One declared parameter, keyed by its name. */
export type ParamSpec = Omit<EndpointParam, "key">;

/** One declared return, keyed by its name: its type, or the whole declaration. */
export type ReturnSpec = ReturnValueType | Omit<EndpointReturn, "key">;

type Scalar<T> = T extends "int" ? number : T extends "bool" ? boolean : string;

type ReturnValue<S> = S extends ReturnValueType
  ? Scalar<S>
  : S extends { type: infer T; list: true }
    ? Array<Scalar<T>>
    : S extends { type: infer T }
      ? Scalar<T>
      : never;

/**
 * What an endpoint answers with: its declared returns, by name. A `list`
 * return is an array. Each may be left out or null; a key the endpoint does
 * not declare is refused.
 */
export type Result<R> = { [K in keyof R]?: ReturnValue<R[K]> | null };

/**
 * A parameter as a caller sent it. Initiative sends strings; an automation
 * may send numbers and booleans as they are.
 */
export type ParamValue = string | number | boolean;

/** The parameters a call carries, by their declared names. */
export type Params<P> = { [K in keyof P]?: P[K] extends { list: true } ? ParamValue[] : ParamValue };

/** Whose behalf a call is on: the community, or one of its members by this installation's reference for them. */
export type Actor = { kind: "installation" } | { kind: "member"; member: string };

/** What every handler is handed. */
export interface Call {
  /** The installation: the community, by the reference this app's install knows it by. */
  installation: string;
  /** Initiative, acting as whoever the call is for. */
  client: Client;
  context: AppContext;
}

export interface EndpointCall<P> extends Call {
  /** The endpoint's manifest id. */
  endpoint: string;
  params: Params<P>;
  /** Initiative's own calls, for a widget, are the community's. */
  actor: Actor;
  /** The app that made this call through Initiative, by its public id, or null for Initiative's own. */
  caller: string | null;
  /** The initiative the call is confined to, when it is. */
  initiative: number | null;
  /** Connection id → the handle Initiative gives a token for, where the call depends on one. */
  connections: Record<string, string>;
}

/** What a handler answers with. `actor` says whose credential ran it; absent, the call's actor. */
export interface Outcome<R> {
  result: Result<R>;
  actor?: ActorKind;
}

type Described = Omit<Endpoint, "id" | "direction" | "params" | "returns">;

/** An endpoint Initiative calls: a `read`, or a `write` another app calls through it. */
export interface CallableEndpoint<P, R, D extends "read" | "write" = "read" | "write"> extends Described {
  direction: D;
  params?: P;
  returns?: R;
  handler: (call: EndpointCall<P>) => Promise<Outcome<R>>;
}

/** An announcement the app emits: declared, never called. */
export interface EmittedEndpoint<R> extends Described {
  direction: "emit";
  returns?: R;
}

export type EndpointDeclaration =
  | CallableEndpoint<any, any>
  | EmittedEndpoint<any>;

/** One endpoint, typed from its own `params` and `returns`. */
export function defineEndpoint<const R extends Record<string, ReturnSpec> = {}>(
  endpoint: EmittedEndpoint<R>
): EmittedEndpoint<R>;
export function defineEndpoint<
  D extends "read" | "write",
  const P extends Record<string, ParamSpec> = {},
  const R extends Record<string, ReturnSpec> = {},
>(endpoint: CallableEndpoint<P, R, D>): CallableEndpoint<P, R, D>;
export function defineEndpoint(endpoint: EndpointDeclaration): EndpointDeclaration {
  return endpoint;
}

/** What `after_connect` is sent, once a connection's flow has exchanged its code. */
export interface AfterConnectCall extends Call {
  /** The connection's manifest id. */
  connection: string;
  /** `member` for a member's own account, `installation` for the community's. */
  actor: ActorKind;
  /** The access token the flow just obtained, to look the account up with. */
  access_token: string;
  /** The flow's parameters, such as the `installation_id` an install page returned. */
  params: Record<string, string>;
}

/** The connection's managed values and the account's label, or a refusal. */
export type AfterConnectAnswer =
  | { values?: Record<string, unknown>; account_label?: string }
  | { refuse: true };

/** What `revoke` is sent when a connection whose flow says `revoke: "hook"` ends. */
export interface RevokeCall extends Call {
  connection: string;
  access_token: string | null;
  refresh_token: string | null;
}

/** One vendor webhook delivery, which Initiative checked and routed to this installation. */
export interface WebhookCall extends Call {
  /** The static connection the delivery was routed by. */
  connection: string;
  /** The vendor's `x-` headers, lowercased. */
  headers: Record<string, string>;
  /** The body exactly as the vendor sent it. */
  body: string;
}

/** One due schedule, for one installation. */
export interface ScheduleCall extends Call {
  schedule: string;
  /** When this schedule last succeeded for the installation (ISO 8601), or null the first time. */
  since: string | null;
}

/** The hooks Initiative calls while it runs connections and receives the vendor's webhooks. */
export interface Hooks {
  after_connect?: (call: AfterConnectCall) => Promise<AfterConnectAnswer>;
  revoke?: (call: RevokeCall) => Promise<void>;
  webhook?: (call: WebhookCall) => Promise<void>;
}

export interface ScheduleDeclaration {
  /** A whole number of minutes (`15m`) or hours (`6h`). */
  every: `${number}${"m" | "h"}`;
  run: (call: ScheduleCall) => Promise<void>;
}

/** A member opening one of the app's surfaces, as the handoff token names them. */
export interface Handoff extends Call {
  surface: string;
  /** The member, by this installation's reference for them. */
  viewer: string;
  /** Whether the viewer administers the community. For shaping screens; not a grant. */
  admin: boolean;
  /** The initiative the surface was opened in, or null for the whole community. */
  initiative: number | null;
}

export interface SurfaceCall {
  request: Request;
  /** Null for a request that carries no handoff token, such as the page's own files. */
  handoff: Handoff | null;
}

/**
 * A page of the app that Initiative frames. The page is the app's own; a
 * request under its path that carries a handoff token reaches the handler with
 * the handoff verified.
 */
export interface SurfaceDeclaration extends Omit<Embed, "id"> {
  handler?: (call: SurfaceCall) => Promise<Response>;
}

type ReadName<E> = {
  [K in keyof E]: E[K] extends { direction: "read" } ? K : never;
}[keyof E] &
  string;

type ReturnsOf<X> = X extends { returns?: infer R } ? NonNullable<R> : {};

/** A dashboard tile the app contributes. `module` is the widget's source file. */
export interface WidgetDeclaration<E> extends Omit<Widget, "id" | "module_source" | "endpoints" | "sample_data"> {
  /** Read endpoints the widget may be bound to. */
  endpoints?: readonly ReadName<E>[];
  /**
   * The widget's TypeScript module, relative to the app's package: it exports
   * `render(data)`. The build bundles it into the manifest's `module_source`.
   */
  module: string;
  /** What each endpoint would answer, for a preview with no network call. */
  sample_data?: { [K in ReadName<E>]?: Result<ReturnsOf<E[K]>> };
}

export interface DashboardDeclaration<E, W> extends Omit<BundledDashboard, "widgets"> {
  widgets: Array<
    Omit<BundledDashboardWidget, "type" | "binding"> & {
      type: keyof W & string;
      binding: Omit<BundledDashboardWidget["binding"], "endpoint_id"> & { endpoint_id: ReadName<E> };
    }
  >;
}

/**
 * The app's registry listing. `initiative-app build --registry <dir>` writes it
 * while `version` is the package's own version.
 */
export interface ListingDeclaration {
  /** The publisher's prefix, the part of the public id before the first dot. */
  publisher: string;
  /** One or two sentences for the listing's card. */
  summary: string;
  /** The listing page's longer text. Markdown. */
  description?: string;
  /** The listing's picture, relative to the app's package. */
  avatar: string;
  version: string;
  /** The oldest Initiative release this version runs on. */
  minAppVersion?: string;
  releaseNotes?: string;
  /** The container image this version runs, pinned by digest. */
  image: string;
  /** The public keys the app's token requests are verified with. */
  jwks: Jwks;
  /** The most the app may ever be granted. Absent: its `scopes`. */
  scopeCeiling?: Array<Scope | AppScope>;
  referenceSectors?: string[];
}

export interface AppDefinition<E, W> {
  /** `<publisher>.<slug>`. */
  publicId: string;
  /** The catalog id: 14 characters of Crockford base32, minted once (`initiative-app uid`). */
  uid: string;
  name: string;
  scopes?: Array<Scope | AppScope>;
  vendor?: Vendor;
  /** Keyed by connection id. */
  connections?: Record<string, Omit<Connection, "id">>;
  webhooks?: Webhooks;
  /** Keyed by schedule id. Each runs through the `schedule` hook. */
  schedules?: Record<string, ScheduleDeclaration>;
  endpoints?: E;
  /** A read endpoint describing the community's standing with the app's service. */
  guildSummary?: ReadName<E>;
  hooks?: Hooks;
  widgets?: W;
  /** Pages and panels, keyed by surface id. */
  surfaces?: Record<string, SurfaceDeclaration>;
  dashboards?: DashboardDeclaration<E, W>[];
  listing?: ListingDeclaration;
}

/** Any app's definition, as the server and the build read it. */
export type AnyApp = Omit<AppDefinition<any, any>, "endpoints" | "widgets"> & {
  endpoints?: Record<string, EndpointDeclaration>;
  widgets?: Record<string, WidgetDeclaration<any>>;
};

/** The app, declared once. */
export function defineApp<
  const E extends Record<string, EndpointDeclaration> = {},
  const W extends Record<string, WidgetDeclaration<E>> = {},
>(definition: AppDefinition<E, W>): AppDefinition<E, W> {
  return definition;
}

/** An endpoint's manifest id. */
export function endpointId(app: { publicId: string }, name: string): string {
  return `app.${app.publicId}.${name}`;
}

/**
 * The manifest a definition declares: its handlers left out, its keys made
 * ids, in the contract's order. Each widget's `module_source` is taken from
 * `modules` by widget id.
 */
export function manifestOf(app: AnyApp, modules: Record<string, string> = {}): Manifest {
  const id = (name: string) => endpointId(app, name);
  const blocks: Partial<Manifest> = {
    vendor: app.vendor,
    connections: listOf(app.connections, (key, connection) => ({ id: key, ...connection })),
    webhooks: app.webhooks,
    schedules: listOf(app.schedules, (key, schedule) => ({ id: key, every: schedule.every })),
    endpoints: listOf(app.endpoints, (key, endpoint) => endpointOf(id(key), endpoint, id)),
    guild_summary: app.guildSummary === undefined ? undefined : id(app.guildSummary),
    widgets: listOf(app.widgets, (key, widget) => widgetOf(key, widget, modules[key] ?? "", id)),
    embeds: listOf(app.surfaces, (key, surface) => {
      const { handler: _handler, ...embed } = surface;
      return { id: key, ...embed };
    }),
    dashboards: app.dashboards?.map((dashboard) => ({
      ...dashboard,
      widgets: dashboard.widgets.map((widget) => ({
        ...widget,
        binding: { ...widget.binding, endpoint_id: id(widget.binding.endpoint_id) },
      })),
    })),
  };
  const present = Object.fromEntries(
    Object.entries(blocks).filter(([, value]) => value !== undefined)
  ) as Partial<Manifest>;
  return {
    app_kind: "service",
    service: { public_id: app.publicId, protocol: 1, ...(app.scopes ? { scopes: [...app.scopes] } : {}) },
    features: FEATURES.filter((feature) => present[feature] !== undefined),
    default_name: app.name,
    ...present,
  };
}

/** A record's entries as a list, or undefined when it holds none. */
function listOf<T, U>(record: Record<string, T> | undefined, build: (key: string, value: T) => U): U[] | undefined {
  const entries = Object.entries(record ?? {});
  return entries.length ? entries.map(([key, value]) => build(key, value)) : undefined;
}

/** The declaration in the author's own order, with its keys made ids. */
function endpointOf(endpointIdValue: string, endpoint: EndpointDeclaration, id: (name: string) => string): Endpoint {
  const out: Record<string, unknown> = { id: endpointIdValue };
  for (const [key, value] of Object.entries(endpoint)) {
    if (key === "handler") continue;
    if (key === "params") {
      out.params = Object.entries(value as Record<string, ParamSpec>).map(([name, param]) => ({
        key: name,
        ...param,
        ...(param.options_from ? { options_from: { ...param.options_from, endpoint: id(param.options_from.endpoint) } } : {}),
      }));
    } else if (key === "returns") {
      out.returns = Object.entries(value as Record<string, ReturnSpec>).map(([name, spec]) =>
        typeof spec === "string" ? { key: name, type: spec } : { key: name, ...spec }
      );
    } else out[key] = value;
  }
  return out as unknown as Endpoint;
}

function widgetOf(
  key: string,
  widget: WidgetDeclaration<any>,
  source: string,
  id: (name: string) => string
): Widget {
  const out: Record<string, unknown> = { id: key };
  for (const [field, value] of Object.entries(widget)) {
    if (field === "module") out.module_source = source;
    else if (field === "endpoints") out.endpoints = (value as string[]).map(id);
    else if (field === "sample_data") {
      out.sample_data = Object.fromEntries(Object.entries(value as object).map(([name, sample]) => [id(name), sample]));
    } else out[field] = value;
  }
  return out as unknown as Widget;
}
