/**
 * `initiative-app build`: the manifest with each widget bundled into it, and
 * the registry source while the listing names the package's version, or a
 * check that the committed files are what the definition produces.
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { build } from "../src/build.js";

const here = dirname(fileURLToPath(import.meta.url));
const sdk = join(here, "..", "src", "manifest.js");
const avatar = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

let root: string;
let errors: string[];

function app(extra = "", listing = ""): string {
  return `
import { defineApp, defineEndpoint } from ${JSON.stringify(sdk)};

export const count = defineEndpoint({
  direction: "read",
  returns: { total: "int" },
  handler: async () => ({ result: { total: 1 } }),
});

export default defineApp({
  publicId: "acme.tracker",
  uid: "K7M2QX8N4TVB9C",
  name: "Tracker",
  endpoints: { count },
  widgets: { total: { meta: { name: { en: "Total" } }, endpoints: ["count"], module: "widgets/total.ts" } },
  listing: {
    publisher: "acme",
    summary: "Tickets.",
    avatar: "assets/avatar.png",
    version: "1.2.0",
    releaseNotes: "First.",
    image: "ghcr.io/acme/tracker@sha256:${"a".repeat(64)}",
    ${listing}
  },
  ${extra}
});
`;
}

/** A declarative app: one read Initiative makes and maps itself. */
function declarative(map: string, extra = ""): string {
  return `
import { defineApp, defineEndpoint } from ${JSON.stringify(sdk)};

export default defineApp({
  publicId: "acme.tracker",
  uid: "K7M2QX8N4TVB9C",
  name: "Tracker",
  hosts: ["api.tracker.example"],
  connections: {
    account: {
      scope: "interactive",
      label: { en: "Account" },
      fields: [],
      flow: { type: "oauth2", authorize_url: "https://tracker.example/a", token_url: "https://tracker.example/t", client_id: "tracker" },
    },
  },
  endpoints: {
    count: defineEndpoint({
      direction: "read",
      requires: { all_of: ["account"] },
      returns: { total: "int" },
      request: { method: "GET", url: '"https://api.tracker.example/count"', connection: "account" },
      map: ${JSON.stringify(map)},
    }),
  },
  listing: { publisher: "acme", summary: "Tickets.", avatar: "assets/avatar.png", version: "1.2.0", ${extra} },
});
`;
}

const WIDGET = `
import { label } from "./words.js";

export function render(data: { values: { total?: number } }) {
  return { v: 1, scene: { kind: "metric" as const, value: data.values.total ?? 0, label } };
}
`;

function write(files: Record<string, string | Buffer>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

const run = (options: { registry?: string; check?: boolean } = {}) =>
  build({ root, app: "src/app.ts", check: false, ...options });

beforeEach(() => {
  root = mkdtempSync(join(here, ".build-"));
  errors = [];
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errors.push(String(chunk));
    return true;
  });
  write({
    "package.json": JSON.stringify({ name: "tracker", version: "1.2.0" }),
    "src/app.ts": app(),
    "widgets/total.ts": WIDGET,
    "widgets/words.ts": 'export const label = "Open";\n',
    "assets/avatar.png": avatar,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const manifest = () => JSON.parse(readFileSync(join(root, "manifest.json"), "utf-8"));

describe("build", () => {
  it("writes the manifest with each widget bundled into one script that leaves render as a global", async () => {
    expect(await run()).toBe(0);
    const [widget] = manifest().widgets;
    expect(widget).toMatchObject({ id: "total", endpoints: ["app.acme.tracker.count"] });
    expect(widget.module_source).not.toMatch(/\bimport\b|\bexport\b/);
    const sandbox: Record<string, unknown> = {};
    runInNewContext(widget.module_source, sandbox);
    expect((sandbox.render as (data: unknown) => unknown)({ values: { total: 4 } })).toEqual({
      v: 1,
      scene: { kind: "metric", value: 4, label: "Open" },
    });
  });

  it("checks the committed files, and fails once a widget changes without a build", async () => {
    await run();
    expect(await run({ check: true })).toBe(0);
    write({ "widgets/words.ts": 'export const label = "Still open";\n' });
    expect(await run({ check: true })).toBe(1);
    expect(errors.join("")).toContain("manifest.json is out of date");
  });

  it("refuses a manifest that does not validate, and writes nothing", async () => {
    write({ "src/app.ts": app('schedules: { sweep: { every: "1m", run: async () => {} } },') });
    expect(await run()).toBe(1);
    expect(errors.join("")).toContain("/schedules/0/every");
    expect(existsSync(join(root, "manifest.json"))).toBe(false);
  });

  it("refuses a widget over the size cap", async () => {
    write({ "widgets/words.ts": `export const label = "${"x".repeat(70_000)}";\n` });
    expect(await run()).toBe(1);
    expect(errors.join("")).toContain("over the 65536-byte cap");
  });
});

describe("the registry source", () => {
  it("is the listing, this version's manifest and the avatar, while the listing names the package's version", async () => {
    expect(await run({ registry: "registry" })).toBe(0);
    const source = join(root, "registry", "acme", "K7M2QX8N4TVB9C");
    expect(JSON.parse(readFileSync(join(source, "listing.json"), "utf-8"))).toEqual({
      schema: 1,
      uid: "K7M2QX8N4TVB9C",
      public_id: "acme.tracker",
      publisher: "acme",
      kind: "app",
      name: "Tracker",
      summary: "Tickets.",
      avatar: { path: "assets/avatar.png", sha256: createHash("sha256").update(avatar).digest("hex") },
      versions: [{ version: "1.2.0", definition: "1.2.0/manifest.json", release_notes: "First." }],
      registration: {
        kind: "container",
        image: `ghcr.io/acme/tracker@sha256:${"a".repeat(64)}`,
        scope_ceiling: [],
        reference_sectors: [],
      },
    });
    expect(JSON.parse(readFileSync(join(source, "1.2.0", "manifest.json"), "utf-8"))).toEqual(manifest());
    expect(readFileSync(join(source, "assets", "avatar.png"))).toEqual(avatar);
    expect(await run({ registry: "registry", check: true })).toBe(0);
  });

  it("carries the listing's compose snippet in its registration", async () => {
    const service = "tracker:\n  image: ${IMAGE}\n  environment:\n    INITIATIVE_URL: ${INITIATIVE_URL}\n";
    write({
      "src/app.ts": app("", `compose: { service: ${JSON.stringify(service)}, baseUrl: "http://tracker:8080" },`),
    });
    expect(await run({ registry: "registry" })).toBe(0);
    const listing = JSON.parse(
      readFileSync(join(root, "registry", "acme", "K7M2QX8N4TVB9C", "listing.json"), "utf-8")
    );
    expect(listing.registration.compose).toEqual({ service, base_url: "http://tracker:8080" });
  });

  it("refuses a compose snippet with another placeholder or an address that is not http", async () => {
    const service = "tracker:\n  image: ${IMAGES}\n  command: [\"$${HOME}\"]\n";
    write({
      "src/app.ts": app("", `compose: { service: ${JSON.stringify(service)}, baseUrl: "ftp://tracker" },`),
    });
    expect(await run()).toBe(1);
    const text = errors.join("");
    expect(text).toContain("${IMAGES} is not a placeholder");
    expect(text).toContain("${HOME} is not a placeholder");
    expect(text).toContain("baseUrl is an http or https URL");
    expect(existsSync(join(root, "manifest.json"))).toBe(false);
  });

  it("is left as it was between releases", async () => {
    write({ "package.json": JSON.stringify({ name: "tracker", version: "1.3.0" }) });
    expect(await run({ registry: "registry" })).toBe(0);
    expect(existsSync(join(root, "registry"))).toBe(false);
    expect(existsSync(join(root, "manifest.json"))).toBe(true);
  });
});

describe("a declarative app", () => {
  it("fails the build on an expression that does not parse, at its place", async () => {
    write({ "src/app.ts": declarative('{"total": response.body.count') });
    expect(await run()).toBe(1);
    expect(errors.join("")).toMatch(/manifest\/endpoints\/0\/map: does not parse: .* \(at character \d+\)/);
    expect(existsSync(join(root, "manifest.json"))).toBe(false);
  });

  it("is registered as declarative, with no image", async () => {
    write({ "src/app.ts": declarative('{"total": response.body.count}') });
    expect(await run({ registry: "registry" })).toBe(0);
    expect(manifest()).not.toHaveProperty("service");
    const listing = JSON.parse(readFileSync(join(root, "registry", "acme", "K7M2QX8N4TVB9C", "listing.json"), "utf-8"));
    expect(listing.registration).toEqual({ kind: "declarative", scope_ceiling: [], reference_sectors: [] });
  });

  it("refuses an image, and a container app's listing without one", async () => {
    write({ "src/app.ts": declarative("{}", `image: "ghcr.io/acme/tracker@sha256:${"a".repeat(64)}"`) });
    expect(await run()).toBe(1);
    expect(errors.join("")).toContain("listing: a declarative app has no image or compose service");
    write({ "src/app.ts": app().replace(/image: .*\n/, "") });
    expect(await run()).toBe(1);
    expect(errors.join("")).toContain("listing: a container app names its image");
  });
});
