/**
 * `initiative-app build`: the manifest with each widget bundled into it, and
 * the registry source while the listing names the package's version, or a
 * check that the committed files are what the definition produces. `pack`,
 * the listing file a deployment publishes as its own app, and `dev`, which
 * uploads it to one as Initiative's listing upload takes it, again on each
 * change.
 */

import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { build } from "../src/build.js";
import { dev } from "../src/dev.js";
import { pack } from "../src/pack.js";

const here = dirname(fileURLToPath(import.meta.url));
const sdk = join(here, "..", "src", "manifest.js");
const avatar = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

let root: string;
let errors: string[];
let output: string[];

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
  output = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
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

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const picture = `/api/v1/marketplace/media/${digest(avatar)}`;

describe("pack", () => {
  it("writes the listing file a deployment publishes, its picture named by its digest", async () => {
    write({ "src/app.ts": declarative('{"total": response.body.count}') });
    expect(await run()).toBe(0);
    expect(await pack({ root, app: "src/app.ts" })).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "acme.tracker-1.2.0.json"), "utf-8"))).toEqual({
      uid: "K7M2QX8N4TVB9C",
      public_id: "acme.tracker",
      kind: "app",
      name: "Tracker",
      publisher: "acme",
      description: "Tickets.",
      avatar_url: picture,
      version: "1.2.0",
      definition: manifest(),
      registration: { kind: "declarative", scope_ceiling: [] },
    });
  });

  it("packs a container app with its image, and leaves out a picture a deployment does not keep", async () => {
    write({ "src/app.ts": app().replace("assets/avatar.png", "assets/avatar.svg"), "assets/avatar.svg": "<svg/>" });
    expect(await pack({ root, app: "src/app.ts", out: "tracker.json" })).toBe(0);
    const listing = JSON.parse(readFileSync(join(root, "tracker.json"), "utf-8"));
    expect(listing).not.toHaveProperty("avatar_url");
    expect(listing.release_notes).toBe("First.");
    expect(listing.registration).toEqual({ kind: "container", image: `ghcr.io/acme/tracker@sha256:${"a".repeat(64)}`, scope_ceiling: [] });
    expect(output.join("")).toContain("assets/avatar.svg is not PNG, JPEG, GIF or WebP");
  });
});

/**
 * A deployment's listing upload and listing pictures, as an owner's API key
 * reaches them: a version is published once, and again only with the same
 * content.
 */
async function fakeInitiative() {
  const uploads: Array<Record<string, any>> = [];
  const pictures: Buffer[] = [];
  const published = new Map<string, string>();
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const answer = (status: number, json: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(json));
    };
    if (request.headers.authorization !== "Bearer ppk_owner") return answer(401, { detail: "COULD_NOT_VALIDATE_CREDENTIALS" });
    if (request.url === "/api/v1/marketplace/local/media") {
      const form = await new Request("http://initiative", { method: "POST", headers: { "content-type": String(request.headers["content-type"]) }, body }).formData();
      const file = Buffer.from(await (form.get("file") as Blob).arrayBuffer());
      pictures.push(file);
      return answer(201, { path: `/api/v1/marketplace/media/${digest(file)}` });
    }
    const { manifest: listing } = JSON.parse(body.toString("utf-8"));
    const key = `${listing.uid} ${listing.version}`;
    if (published.has(key) && published.get(key) !== JSON.stringify(listing)) {
      return answer(422, { detail: "LISTING_UPLOAD_INVALID", problem: `version ${listing.version} is already published with different content` });
    }
    published.set(key, JSON.stringify(listing));
    uploads.push(listing);
    answer(201, { uid: listing.uid, public_id: listing.public_id, version: listing.version });
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, uploads, pictures, close: () => server.close() };
}

async function until(holds: () => boolean): Promise<void> {
  for (let waited = 0; !holds(); waited += 20) {
    if (waited > 10_000) throw new Error("timed out");
    await new Promise((tick) => setTimeout(tick, 20));
  }
}

describe("dev", () => {
  it("uploads the listing with its picture, and again under a new version when the source changes", async () => {
    const initiative = await fakeInitiative();
    write({ "src/app.ts": declarative('{"total": response.body.count}') });
    const stop = new AbortController();
    const running = dev({ root, app: "src/app.ts", initiative: initiative.url, apiKey: "ppk_owner", signal: stop.signal });
    try {
      await until(() => initiative.uploads.length === 1);
      const [first] = initiative.uploads;
      expect(first.version).toMatch(/^1\.2\.0-dev\.[0-9a-f]{8}$/);
      expect(first).toMatchObject({ uid: "K7M2QX8N4TVB9C", avatar_url: picture, registration: { kind: "declarative" } });
      expect(initiative.pictures[0]).toEqual(avatar);
      await until(() => output.join("").includes("watching"));
      expect(output.join("")).toContain(
        `uploaded acme.tracker ${first.version} (uid K7M2QX8N4TVB9C): 201 {"uid":"K7M2QX8N4TVB9C","public_id":"acme.tracker","version":"${first.version}"}`
      );

      write({ "src/app.ts": declarative('{"total": response.body.total}') });
      await until(() => initiative.uploads.length === 2);
      expect(initiative.uploads[1].version).not.toBe(first.version);
      expect(initiative.uploads[1].definition.endpoints[0].map).toBe('{"total": response.body.total}');
    } finally {
      stop.abort();
      initiative.close();
    }
    expect(await running).toBe(0);
  });

  it("stops when the deployment refuses the key, and refuses a container app", async () => {
    const initiative = await fakeInitiative();
    try {
      write({ "src/app.ts": declarative('{"total": response.body.count}') });
      expect(await dev({ root, app: "src/app.ts", initiative: initiative.url, apiKey: "ppk_nobody" })).toBe(1);
      expect(errors.join("")).toContain('refused the picture: 401 {"detail":"COULD_NOT_VALIDATE_CREDENTIALS"}');
      write({ "src/app.ts": app() });
      expect(await dev({ root, app: "src/app.ts", initiative: initiative.url, apiKey: "ppk_owner" })).toBe(1);
      expect(errors.join("")).toContain("dev uploads a declarative app");
      expect(initiative.uploads).toEqual([]);
    } finally {
      initiative.close();
    }
  });
});
