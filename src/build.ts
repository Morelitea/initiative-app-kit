/**
 * `initiative-app build`: the files an app's definition produces.
 *
 * - `manifest.json`: the manifest, with each widget's module bundled into its
 *   `module_source`, after `validateManifest` has passed it.
 * - With `--registry <dir>`, the app's registry source under
 *   `<dir>/<publisher>/<uid>/`: `listing.json`, this version's
 *   `<version>/manifest.json` and the avatar. It is written only while the
 *   listing names the package's own version: between releases the package
 *   runs ahead of its listing, and what the listing already publishes is left
 *   as it was.
 *
 * With `--check` nothing is written, and any file that differs from what would
 * be written is a failure.
 *
 * Bundling uses esbuild, which the app installs beside the SDK
 * (`npm install --save-dev esbuild`). Nothing at run time needs it.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { CAPS } from "./contract.js";
import { manifestOf, type AnyApp } from "./define.js";
import { validateManifest } from "./validate.js";

export interface BuildOptions {
  /** The app's package directory. */
  root: string;
  /** The module whose default export is the app's definition, relative to `root`. */
  app: string;
  /** Where registry sources live; the app's is written under `<publisher>/<uid>/`. */
  registry?: string;
  check: boolean;
}

type Esbuild = typeof import("esbuild");

/** Build, or check, the app's files. Answers the process's exit code. */
export async function build(options: BuildOptions): Promise<number> {
  let esbuild: Esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    process.stderr.write("initiative-app build bundles with esbuild: npm install --save-dev esbuild\n");
    return 1;
  }
  const root = resolve(options.root);
  const app = await loadApp(esbuild, root, options.app);

  const modules: Record<string, string> = {};
  const problems: string[] = [];
  for (const [id, widget] of Object.entries(app.widgets ?? {})) {
    const source = await bundleWidget(esbuild, root, widget.module);
    const bytes = Buffer.byteLength(source, "utf-8");
    if (bytes > CAPS.moduleSourceBytes) {
      problems.push(`widget ${id}: ${widget.module} bundles to ${bytes} bytes, over the ${CAPS.moduleSourceBytes}-byte cap`);
    }
    modules[id] = source;
  }
  const manifest = manifestOf(app, modules);
  problems.push(...validateManifest(manifest).map((problem) => `manifest${problem.where}: ${problem.message}`));
  if (problems.length) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    return 1;
  }

  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const outputs: Array<[string, string | Buffer]> = [[join(root, "manifest.json"), manifestText]];
  if (options.registry !== undefined) {
    const listing = app.listing;
    if (!listing) {
      process.stderr.write("--registry was given, but the app declares no listing\n");
      return 1;
    }
    const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string }).version;
    if (version === listing.version) {
      const avatar = readFileSync(resolve(root, listing.avatar));
      const source = resolve(root, options.registry, listing.publisher, app.uid);
      outputs.push(
        [join(source, "listing.json"), `${JSON.stringify(listingSource(app, avatar), null, 2)}\n`],
        [join(source, listing.version, "manifest.json"), manifestText],
        [join(source, "assets", basename(listing.avatar)), avatar]
      );
    } else {
      process.stdout.write(`the registry source lists ${listing.version}; ${version} is listed at its release\n`);
    }
  }

  let stale = false;
  for (const [path, content] of outputs) {
    const name = relative(process.cwd(), path);
    if (options.check) {
      const current = existsSync(path) ? readFileSync(path) : null;
      if (!current || !current.equals(Buffer.from(content))) {
        process.stderr.write(`${name} is out of date: run initiative-app build\n`);
        stale = true;
      }
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      process.stdout.write(`wrote ${name}\n`);
    }
  }
  return stale ? 1 : 0;
}

/** The app's definition, compiled from its TypeScript and imported. */
async function loadApp(esbuild: Esbuild, root: string, entry: string): Promise<AnyApp> {
  const outfile = join(root, "node_modules", ".cache", "initiative-app", `app-${process.pid}-${Date.now()}.mjs`);
  await esbuild.build({
    entryPoints: [resolve(root, entry)],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "error",
  });
  try {
    const loaded = (await import(pathToFileURL(outfile).href)) as { default?: AnyApp };
    const app = loaded.default;
    if (!app || typeof app.publicId !== "string") {
      throw new Error(`${entry} must export the app's definition as its default export`);
    }
    return app;
  } finally {
    rmSync(outfile, { force: true });
  }
}

/**
 * One widget as the single script the sandbox runs: its module and everything
 * it imports, with `render` left as a global.
 */
async function bundleWidget(esbuild: Esbuild, root: string, module: string): Promise<string> {
  const path = `./${relative(root, resolve(root, module)).split("\\").join("/")}`;
  const result = await esbuild.build({
    stdin: {
      contents: `import { render } from ${JSON.stringify(path)};\nglobalThis.render = render;\n`,
      resolveDir: root,
      sourcefile: "widget.js",
      loader: "js",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "neutral",
    target: "es2020",
    charset: "utf8",
    legalComments: "none",
    logLevel: "error",
  });
  return result.outputFiles[0].text.trimEnd();
}

/** The registry source listing: what the catalogue shows, this version, and the registration. */
function listingSource(app: AnyApp, avatar: Buffer): Record<string, unknown> {
  const listing = app.listing!;
  return {
    schema: 1,
    uid: app.uid,
    public_id: app.publicId,
    publisher: listing.publisher,
    kind: "app",
    name: app.name,
    summary: listing.summary,
    ...(listing.description !== undefined ? { description: listing.description } : {}),
    avatar: {
      path: `assets/${basename(listing.avatar)}`,
      sha256: createHash("sha256").update(avatar).digest("hex"),
    },
    versions: [
      {
        version: listing.version,
        definition: `${listing.version}/manifest.json`,
        ...(listing.minAppVersion !== undefined ? { min_app_version: listing.minAppVersion } : {}),
        ...(listing.releaseNotes !== undefined ? { release_notes: listing.releaseNotes } : {}),
      },
    ],
    registration: {
      kind: "container",
      image: listing.image,
      jwks: listing.jwks,
      scope_ceiling: [...(listing.scopeCeiling ?? app.scopes ?? [])],
      reference_sectors: [...(listing.referenceSectors ?? [])],
    },
  };
}
