/**
 * What has to be true of a file before an operator drops it in a catalog
 * directory.
 *
 * The failure this guards is quiet in a way the others are not. A manifest that
 * is wrong is refused at registration, loudly, to somebody who is watching. A
 * listing that is wrong is skipped during a directory rescan and named in a log
 * — so the app is registered, live and healthy, and simply never appears in
 * anybody's marketplace.
 *
 * The other half is the tie between two listings: a companion dashboard draws
 * an app's widgets, and the only thing joining them is the uid.
 */

import { describe, expect, it } from "vitest";

import {
  UID_LENGTH,
  appDocument,
  appListing,
  appWidgetParts,
  appWidgetType,
  dashboardListing,
  isUid,
  mintUid,
  validateListing,
  type Listing,
  type Manifest,
} from "../src/index.js";

const UID = "K7M2QX8N4TVB9C";
const DASHBOARD_UID = "P3R9WT5HZ2NM6D";

const manifest: Manifest = {
  app_kind: "service",
  service: { public_id: "acme.tracker", protocol: 1 },
  features: ["data", "widgets"],
  default_name: "Tracker",
  data_sources: [{ id: "open-items", path: "/data/open-items" }],
  widgets: [
    {
      id: "open-items",
      meta: { name: { en: "Open items" } },
      module_source: "export default () => ({ kind: 'metric', value: 0 });",
      sources: ["open-items"],
      sample_data: { "open-items": { total: 3 } },
    },
  ],
};

const meta = {
  name: "Tracker",
  publisher: "Acme",
  description: "Track the things.",
  version: "1.0.0",
};

const listing = () => appListing(appDocument(manifest, { uid: UID }), meta);

describe("the uid", () => {
  it("mints one the catalog will take", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const uid = mintUid();
      expect(uid).toHaveLength(UID_LENGTH);
      expect(isUid(uid)).toBe(true);
    }
  });

  it("mints a different one each time", () => {
    expect(new Set(Array.from({ length: 100 }, mintUid)).size).toBe(100);
  });

  it("refuses the letters Crockford leaves out", () => {
    // No I, L, O or U — so a uid read aloud or copied off a screen is not
    // ambiguous with 1 and 0.
    for (const letter of ["I", "L", "O", "U"]) {
      expect(isUid(`${letter}${"0".repeat(UID_LENGTH - 1)}`)).toBe(false);
    }
    expect(isUid("TOO-SHORT")).toBe(false);
    expect(isUid(UID.toLowerCase())).toBe(false);
  });
});

describe("an app's own listing", () => {
  it("takes its identity from the document rather than being retyped", () => {
    const published = listing();
    expect(published.uid).toBe(UID);
    expect(published.public_id).toBe("acme.tracker");
    expect(published.kind).toBe("app");
    // The definition is the manifest itself, not a copy that can age.
    expect(published.definition).toBe(manifest);
    expect(validateListing(published)).toEqual([]);
  });

  it("refuses to be built from a document with no uid", () => {
    // The failure this is worth having: a document without a uid registers
    // fine, so nothing else notices until an install goes looking for a listing.
    expect(() => appListing(appDocument(manifest), meta)).toThrow(/no uid/);
  });

  it("catches a public_id that stopped matching the app", () => {
    const drifted = { ...listing(), public_id: "acme.something-else" };
    expect(validateListing(drifted)).toContainEqual(
      expect.objectContaining({ where: "/public_id" })
    );
  });

  it("reports a broken manifest under its own path", () => {
    const broken = {
      ...listing(),
      definition: { ...manifest, features: ["widgets"] } as Manifest,
    };
    const problems = validateListing(broken);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((problem) => problem.where.startsWith("/definition"))).toBe(true);
  });
});

describe("what the catalog requires", () => {
  const withField = (field: string, value: unknown): unknown => ({
    ...listing(),
    [field]: value,
  });
  const problemsAt = (body: unknown, where: string) =>
    validateListing(body).filter((problem) => problem.where === where);

  it("names who publishes it", () => {
    // A listing is never published anonymously: whoever publishes is who a
    // reader is trusting.
    expect(problemsAt(withField("publisher", ""), "/publisher")).toHaveLength(1);
    expect(problemsAt(withField("publisher", undefined), "/publisher")).toHaveLength(1);
  });

  it("carries a name and a one-line description", () => {
    expect(problemsAt(withField("name", ""), "/name")).toHaveLength(1);
    expect(problemsAt(withField("description", undefined), "/description")).toHaveLength(1);
  });

  it("carries a version", () => {
    expect(problemsAt(withField("version", ""), "/version")).toHaveLength(1);
    expect(problemsAt(withField("version", "1.0 final"), "/version")).toHaveLength(1);
    expect(problemsAt(withField("version", "x".repeat(40)), "/version")).toHaveLength(1);
    expect(problemsAt(withField("version", "1.0.0-rc1"), "/version")).toHaveLength(0);
  });

  it("keeps artwork same-origin", () => {
    // A catalog mirrors artwork locally rather than linking out, so a listing
    // page loads nothing from a publisher's own host.
    expect(problemsAt(withField("avatar_url", "https://cdn.example.com/a.png"), "/avatar_url"))
      .toHaveLength(1);
    expect(problemsAt(withField("avatar_url", "/marketplace/acme/../../etc"), "/avatar_url"))
      .toHaveLength(1);
    expect(problemsAt(withField("avatar_url", "/marketplace/acme/icon.svg"), "/avatar_url"))
      .toHaveLength(0);
    expect(problemsAt(withField("images", ["//evil.example.com/x.png"]), "/images/0"))
      .toHaveLength(1);
  });

  it("refuses a uid that is not one", () => {
    expect(problemsAt(withField("uid", "nope"), "/uid")).toHaveLength(1);
  });
});

describe("a companion dashboard", () => {
  const companion = () =>
    dashboardListing(listing(), {
      uid: DASHBOARD_UID,
      public_id: "acme.tracker-overview",
      meta: { ...meta, name: "Tracker overview" },
      layout: { columns: 12 },
      widgets: [
        {
          id: "open",
          type: appWidgetType(UID, "open-items"),
          title: "Open items",
          grid: { x: 0, y: 0, w: 4, h: 3 },
          binding: { source_id: "open-items" },
        },
      ],
    });

  it("is a listing of its own, tied to the app by uid", () => {
    const dashboard = companion();
    // Its own entry in the catalog — installed separately, with its own id.
    expect(dashboard.uid).toBe(DASHBOARD_UID);
    expect(dashboard.uid).not.toBe(UID);
    expect(dashboard.public_id).toBe("acme.tracker-overview");
    expect(dashboard.kind).toBe("dashboard");
    expect(validateListing(dashboard)).toEqual([]);
  });

  it("fills in the binding's app from the app listing", () => {
    // Typed once. The uid appears in the widget type and in the binding, and
    // the platform refuses them if they disagree.
    const widget = (companion().definition as { widgets: Array<Record<string, any>> })
      .widgets[0];
    expect(widget.binding).toEqual({
      source: "app",
      app_uid: UID,
      source_id: "open-items",
    });
    expect(appWidgetParts(widget.type)).toEqual({ uid: UID, widgetId: "open-items" });
  });

  it("refuses a widget the app does not declare", () => {
    // The check nothing downstream can make. A published dashboard is a
    // standalone file, so a widget id the app has since renamed installs
    // cleanly and draws nothing.
    expect(() =>
      dashboardListing(listing(), {
        uid: DASHBOARD_UID,
        public_id: "acme.tracker-overview",
        meta,
        widgets: [
          {
            type: appWidgetType(UID, "renamed-away"),
            binding: { source_id: "open-items" },
          },
        ],
      })
    ).toThrow(/declares no widget 'renamed-away'/);
  });

  it("refuses a binding to a source the app does not declare", () => {
    expect(() =>
      dashboardListing(listing(), {
        uid: DASHBOARD_UID,
        public_id: "acme.tracker-overview",
        meta,
        widgets: [
          {
            type: appWidgetType(UID, "open-items"),
            binding: { source_id: "no-such-source" },
          },
        ],
      })
    ).toThrow(/declares no data source 'no-such-source'/);
  });

  it("refuses a widget belonging to a different app", () => {
    expect(() =>
      dashboardListing(listing(), {
        uid: DASHBOARD_UID,
        public_id: "acme.tracker-overview",
        meta,
        widgets: [
          {
            type: appWidgetType(DASHBOARD_UID, "open-items"),
            binding: { source_id: "open-items" },
          },
        ],
      })
    ).toThrow(/is not one of acme.tracker's/);
  });

  it("catches a widget pointed at another app's data", () => {
    // The rule the platform enforces: a widget is one app's module and its
    // sources are that app's.
    const dashboard = companion();
    const definition = dashboard.definition as { widgets: Array<Record<string, any>> };
    definition.widgets[0].binding.app_uid = DASHBOARD_UID;

    expect(validateListing(dashboard)).toContainEqual(
      expect.objectContaining({ where: "/definition/widgets/0/binding/app_uid" })
    );
  });

  it("catches a widget type that is not an app's", () => {
    const dashboard = companion();
    (dashboard.definition as { widgets: Array<Record<string, any>> }).widgets[0].type =
      "metric";

    expect(validateListing(dashboard)).toContainEqual(
      expect.objectContaining({ where: "/definition/widgets/0/type" })
    );
  });

  it("catches two widgets sharing an id", () => {
    const dashboard = companion();
    const definition = dashboard.definition as { widgets: Array<Record<string, any>> };
    definition.widgets.push({ ...definition.widgets[0] });

    expect(validateListing(dashboard)).toContainEqual(
      expect.objectContaining({ where: "/definition/widgets/1/id" })
    );
  });

  it("refuses a dashboard with nothing on it", () => {
    const empty: Listing = {
      ...companion(),
      definition: { schema_version: 1, kind: "dashboard", widgets: [] },
    };
    expect(validateListing(empty)).toContainEqual(
      expect.objectContaining({ where: "/definition/widgets" })
    );
  });
});
