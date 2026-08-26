/**
 * Publishing: the file that puts your app in somebody's marketplace.
 *
 * Serving a manifest and being installable are two different things, and an app
 * that has done only the first is invisible. The document at
 * `/.well-known/initiative-app.json` is what a *registrar* fetches to verify a
 * container an operator has already decided to run. A **listing** is what a
 * *guild admin* browses and installs. Nothing derives one from the other, so an
 * app that ships no listing is registered, live, healthy, and cannot be added
 * by anybody.
 *
 * A listing is a JSON file. An operator points
 * `MARKETPLACE_EXTRA_CATALOG_DIR` at a directory, drops it in, and it is in
 * their marketplace — no fork, no pull request, no release of Initiative. A
 * file that is removed withdraws the listing; guilds that installed it keep
 * what they have.
 *
 * ## Two kinds, and the second is the interesting one
 *
 * `kind: "app"` is your app. Its `definition` is the very manifest you serve,
 * which is why {@link appListing} takes your served *document* rather than
 * asking you to restate anything: the uid, the public id and the capabilities
 * come from the one place that already has them.
 *
 * `kind: "dashboard"` is a **companion listing** — a second entry in the same
 * marketplace, published by you, that ships a ready-made arrangement of your
 * own widgets. A guild installs your app, then installs your dashboard, and has
 * something to look at without assembling it. It carries no code: it is a
 * layout naming widget types your app's pinned definition already declares.
 *
 * The link between them is the uid. A dashboard widget's type is
 * `app:<your app's uid>:<widget id>`, and its binding must name that same uid —
 * a definition cannot point one app's widget at another app's data. So the two
 * listings are tied by the same immutable id the registration uses, and
 * {@link dashboardListing} takes the app listing itself to get it.
 *
 * ## The uid
 *
 * Publisher-assigned, immutable, and never reused: 14 characters of Crockford
 * base32. Mint one with {@link mintUid} (or `npx initiative-app uid`), write it
 * into your source as a constant, and never change it. It is what ties a
 * verified registration to its listing and a dashboard to the app it draws.
 */

import { randomInt } from "node:crypto";

import { isPublicId } from "./parse.js";

import {
  validateManifest,
  type AppDocument,
  type Manifest,
  type ValidationProblem,
} from "./manifest.js";

/** Kinds a publisher can put in a catalog directory. */
export type ListingKind = "app" | "dashboard";

/** Crockford base32 — no I, L, O or U, so a uid read aloud is unambiguous. */
export const UID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const UID_LENGTH = 14;

/** The prefix that marks a widget type as one an app supplies. */
export const APP_WIDGET_TYPE_PREFIX = "app:";

/** Characters a version string may use. */
const VERSION_CHARS = "0123456789.-+abcdefghijklmnopqrstuvwxyz";
const MAX_VERSION_LENGTH = 32;

/** Characters an artwork path may use. */
const ARTWORK_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/._-";

/** A dashboard listing's grid is 12 columns wide. */
export const MAX_GRID_COLUMNS = 12;

/** How many widgets one dashboard definition may hold. */
export const MAX_WIDGETS = 50;

/** Where a widget sits, in grid cells. */
export interface WidgetGrid {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/**
 * Which of your app's endpoints fills a widget.
 *
 * `app_uid` has to be your own: a widget is your app's module and its endpoints
 * are your app's, so a definition pointing one app's widget at another app's
 * data is refused.
 */
export interface AppBinding {
  source: "app";
  app_uid: string;
  endpoint_id: string;
  /** Fixed parameter values for the endpoint. Scalars only, and at most 12. */
  params?: Record<string, string | number | boolean>;
}

export interface DashboardWidget {
  /** Unique within the definition. Defaults to `w1`, `w2`… if you leave it out. */
  id?: string;
  /** `app:<uid>:<widget id>` for one of yours. */
  type: string;
  title?: string;
  grid?: WidgetGrid;
  binding: AppBinding;
  options?: Record<string, unknown>;
}

/** What a `kind: "dashboard"` listing carries as its definition. */
export interface DashboardDefinition {
  schema_version: 1;
  kind: "dashboard";
  layout?: { columns?: number };
  widgets: DashboardWidget[];
}

/** What a publisher writes into a catalog directory. */
export interface Listing {
  /** 14 characters of Crockford base32. Immutable, never reused. */
  uid: string;
  /** `<publisher>.<slug>`. For an app listing, the app's own. */
  public_id: string;
  kind: ListingKind;
  name: string;
  /** Who publishes it. Required — a listing is never published anonymously. */
  publisher: string;
  /** One line, shown in the marketplace grid. */
  description: string;
  /** The long form on the listing page. Markdown. */
  long_description?: string;
  /**
   * The version being published. Immutable once published: correcting a
   * listing's *content* means publishing a new version, though its name, blurb
   * and artwork stay editable without one.
   */
  version: string;
  /** A same-origin path. Omit to get Initiative's own mark. */
  avatar_url?: string;
  /** Same-origin paths. A remote URL is refused. */
  images?: string[];
  release_notes?: string;
  /** The lowest Initiative version this listing runs on. */
  min_app_version?: string;
  definition: Manifest | DashboardDefinition;
}

/** A fresh catalog uid. Mint once, write it into your source, never change it. */
export function mintUid(): string {
  let uid = "";
  for (let index = 0; index < UID_LENGTH; index += 1) {
    uid += UID_ALPHABET[randomInt(UID_ALPHABET.length)];
  }
  return uid;
}

/** Whether a string is shaped like a catalog uid. */
export function isUid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === UID_LENGTH &&
    [...value].every((character) => UID_ALPHABET.includes(character))
  );
}

/**
 * The type id one of your widgets is offered under.
 *
 * Namespaced by uid, so two apps can both ship a `summary` widget and neither
 * shadows the other or a built-in.
 */
export function appWidgetType(uid: string, widgetId: string): string {
  return `${APP_WIDGET_TYPE_PREFIX}${uid}:${widgetId}`;
}

/** The uid and widget id inside an app widget type, or null if it is not one. */
export function appWidgetParts(
  type: string
): { uid: string; widgetId: string } | null {
  if (!type.startsWith(APP_WIDGET_TYPE_PREFIX)) return null;
  const remainder = type.slice(APP_WIDGET_TYPE_PREFIX.length);
  const separator = remainder.indexOf(":");
  if (separator < 0) return null;
  return {
    uid: remainder.slice(0, separator),
    widgetId: remainder.slice(separator + 1),
  };
}

/** Everything about a listing that is not its identity or its definition. */
export interface ListingMeta {
  name: string;
  publisher: string;
  description: string;
  version: string;
  long_description?: string;
  avatar_url?: string;
  images?: string[];
  release_notes?: string;
  min_app_version?: string;
}

/**
 * Your app's listing, built from the document you serve.
 *
 * Takes the document rather than the manifest so the uid, the public id and the
 * capabilities are read from the one place that already holds them. Restating
 * any of the three in a catalog file is how a listing comes to describe a
 * version of an app that no longer exists.
 *
 * Throws if the document carries no uid — a listing has to have one, and a
 * document without one is the same app failing to name its listing.
 */
export function appListing(document: AppDocument, meta: ListingMeta): Listing {
  if (!document.uid) {
    throw new Error(
      "the served document has no uid — pass one to appDocument() and use the same value here"
    );
  }
  return {
    uid: document.uid,
    public_id: document.public_id,
    kind: "app",
    ...meta,
    definition: document.definition,
  };
}

/**
 * A companion dashboard listing for an app you publish.
 *
 * Takes the app's own listing so the widget bindings resolve against the right
 * uid without it being typed twice. The dashboard needs a uid of its own — it
 * is a separate entry in the catalog, installed separately — and a `public_id`
 * of its own, conventionally the app's with a suffix.
 *
 * Every widget's `binding.app_uid` is filled in from the app listing, and both
 * the widget and the source it binds to are checked against what that app
 * actually declares. This is the one check nothing else can make: a published
 * dashboard is a standalone file, so by the time a deployment reads it there is
 * no manifest beside it to compare against, and a widget naming an id the app
 * renamed installs cleanly and draws nothing.
 */
export function dashboardListing(
  app: Listing,
  options: {
    uid: string;
    public_id: string;
    meta: ListingMeta;
    layout?: { columns?: number };
    widgets: Array<Omit<DashboardWidget, "binding"> & {
      binding: Omit<AppBinding, "source" | "app_uid">;
    }>;
  }
): Listing {
  if (app.kind !== "app") {
    throw new Error("a companion dashboard is built from an app listing");
  }
  const definition = app.definition as Manifest;
  const declaredWidgets = new Set((definition.widgets ?? []).map((w) => w.id));
  // Read endpoints only: a tile is filled by something that answers.
  const declaredEndpoints = new Set(
    (definition.endpoints ?? [])
      .filter((endpoint) => endpoint.direction === "read")
      .map((endpoint) => endpoint.id)
  );

  const widgets: DashboardWidget[] = options.widgets.map((widget) => {
    const parts = appWidgetParts(widget.type);
    if (!parts || parts.uid !== app.uid) {
      throw new Error(
        `widget type ${widget.type} is not one of ${app.public_id}'s — build it with appWidgetType(app uid, widget id)`
      );
    }
    if (!declaredWidgets.has(parts.widgetId)) {
      throw new Error(
        `${app.public_id} declares no widget '${parts.widgetId}' (it has: ${[...declaredWidgets].join(", ") || "none"})`
      );
    }
    if (!declaredEndpoints.has(widget.binding.endpoint_id)) {
      throw new Error(
        `${app.public_id} declares no read endpoint '${widget.binding.endpoint_id}' (it has: ${[...declaredEndpoints].join(", ") || "none"})`
      );
    }
    return {
      ...widget,
      binding: { source: "app", app_uid: app.uid, ...widget.binding },
    };
  });
  return {
    uid: options.uid,
    public_id: options.public_id,
    kind: "dashboard",
    ...options.meta,
    definition: {
      schema_version: 1,
      kind: "dashboard",
      ...(options.layout ? { layout: options.layout } : {}),
      widgets,
    },
  };
}

/**
 * Check a listing before an operator's deployment does.
 *
 * The same rules the catalog applies on ingestion. A listing that fails here is
 * one that is silently skipped on a rescan, named in a log nobody is reading.
 */
export function validateListing(listing: unknown): ValidationProblem[] {
  if (typeof listing !== "object" || listing === null) {
    return [{ where: "", message: "a listing is a JSON object" }];
  }
  const body = listing as Partial<Listing>;
  const problems: ValidationProblem[] = [];
  const fail = (where: string, message: string) =>
    problems.push({ where, message });

  if (!isUid(body.uid)) {
    fail(
      "/uid",
      `must be ${UID_LENGTH} characters of Crockford base32 (${UID_ALPHABET}) — mint one with 'npx initiative-app uid'`
    );
  }
  // The same check the delegation surface makes, from the same helper: one
  // reading of what a public id is, rather than two patterns that drift. The
  // one this replaced admitted `a.` and `a..b`, because a character class says
  // nothing about an empty label.
  if (!isPublicId(body.public_id)) {
    fail("/public_id", "must be '<publisher>.<slug>' in lowercase");
  }
  if (body.kind !== "app" && body.kind !== "dashboard") {
    fail("/kind", "must be 'app' or 'dashboard'");
  }
  for (const field of ["name", "publisher", "description"] as const) {
    const value = body[field];
    if (typeof value !== "string" || !value.trim()) {
      fail(`/${field}`, `is required — a listing states its ${field}`);
    }
  }
  if (
    typeof body.version !== "string" ||
    !body.version ||
    body.version.length > MAX_VERSION_LENGTH ||
    [...body.version].some((character) => !VERSION_CHARS.includes(character))
  ) {
    fail("/version", `must be 1..${MAX_VERSION_LENGTH} characters of ${VERSION_CHARS}`);
  }

  for (const [where, value] of artworkPaths(body)) {
    if (!value.startsWith("/")) {
      fail(where, "must be a same-origin path starting with '/' — mirror remote artwork locally");
    } else if (
      [...value].some((character) => !ARTWORK_CHARS.includes(character)) ||
      value.includes("//") ||
      value.includes("/../") ||
      value.endsWith("/..")
    ) {
      fail(where, "must be a plain same-origin path with no '//' or '..'");
    }
  }
  if (body.images !== undefined && !Array.isArray(body.images)) {
    fail("/images", "must be a list of same-origin paths");
  }

  if (body.kind === "app") {
    problems.push(
      ...validateManifest(body.definition).map((problem) => ({
        where: `/definition${problem.where}`,
        message: problem.message,
      }))
    );
    const declared = (body.definition as Manifest | undefined)?.service?.public_id;
    if (declared && declared !== body.public_id) {
      fail(
        "/public_id",
        `does not match definition.service.public_id (${declared}) — build the listing with appListing() so it cannot drift`
      );
    }
  } else if (body.kind === "dashboard") {
    problems.push(...dashboardProblems(body));
  }

  return problems;
}

function artworkPaths(body: Partial<Listing>): Array<[string, string]> {
  const paths: Array<[string, string]> = [];
  if (typeof body.avatar_url === "string") paths.push(["/avatar_url", body.avatar_url]);
  if (Array.isArray(body.images)) {
    body.images.forEach((image, index) => {
      if (typeof image === "string") paths.push([`/images/${index}`, image]);
    });
  }
  return paths;
}

function dashboardProblems(body: Partial<Listing>): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const definition = body.definition as Partial<DashboardDefinition> | undefined;

  if (!definition || definition.kind !== "dashboard") {
    return [{ where: "/definition/kind", message: "must be 'dashboard'" }];
  }
  if (definition.schema_version !== 1) {
    problems.push({ where: "/definition/schema_version", message: "must be 1" });
  }
  const widgets = definition.widgets;
  if (!Array.isArray(widgets) || widgets.length === 0) {
    return [
      ...problems,
      { where: "/definition/widgets", message: "a dashboard with no widgets shows nothing" },
    ];
  }
  if (widgets.length > MAX_WIDGETS) {
    problems.push({
      where: "/definition/widgets",
      message: `at most ${MAX_WIDGETS} widgets`,
    });
  }

  const seen = new Set<string>();
  widgets.forEach((widget, index) => {
    const where = `/definition/widgets/${index}`;
    const parts = typeof widget.type === "string" ? appWidgetParts(widget.type) : null;
    if (!parts) {
      problems.push({
        where: `${where}/type`,
        message: "must be 'app:<uid>:<widget id>' — build it with appWidgetType()",
      });
      return;
    }
    if (!isUid(parts.uid)) {
      problems.push({ where: `${where}/type`, message: "names a uid that is not one" });
    }
    if (widget.id !== undefined) {
      if (seen.has(widget.id)) {
        problems.push({ where: `${where}/id`, message: `duplicate widget id '${widget.id}'` });
      }
      seen.add(widget.id);
    }

    const binding = widget.binding;
    if (!binding || binding.source !== "app") {
      problems.push({ where: `${where}/binding/source`, message: "must be 'app'" });
      return;
    }
    // The rule the platform enforces and the one worth catching here: a widget
    // is its own app's, and so is the endpoint that fills it.
    if (binding.app_uid !== parts.uid) {
      problems.push({
        where: `${where}/binding/app_uid`,
        message: "must be the same uid the widget type names",
      });
    }
    if (typeof binding.endpoint_id !== "string" || !binding.endpoint_id) {
      problems.push({
        where: `${where}/binding/endpoint_id`,
        message: "names which endpoint fills it",
      });
    }
  });

  return problems;
}
