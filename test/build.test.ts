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
const jwks = { keys: [{ kty: "EC", kid: "k1", alg: "ES256", use: "sig", crv: "P-256", x: "x", y: "y" }] };

let root: string;
let errors: string[];

function app(extra = ""): string {
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
    jwks: ${JSON.stringify(jwks)},
  },
  ${extra}
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
        jwks,
        scope_ceiling: [],
        reference_sectors: [],
      },
    });
    expect(JSON.parse(readFileSync(join(source, "1.2.0", "manifest.json"), "utf-8"))).toEqual(manifest());
    expect(readFileSync(join(source, "assets", "avatar.png"))).toEqual(avatar);
    expect(await run({ registry: "registry", check: true })).toBe(0);
  });

  it("is left as it was between releases", async () => {
    write({ "package.json": JSON.stringify({ name: "tracker", version: "1.3.0" }) });
    expect(await run({ registry: "registry" })).toBe(0);
    expect(existsSync(join(root, "registry"))).toBe(false);
    expect(existsSync(join(root, "manifest.json"))).toBe(true);
  });
});
