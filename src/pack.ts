/**
 * `initiative-app pack`: the app as one listing file, the file a self-hosted
 * deployment publishes as its own app.
 *
 * The listing file is the shape a deployment's listing upload
 * (`POST /api/v1/marketplace/local/upload`, as `{"manifest": <file>}`) and its
 * catalog directory (`MARKETPLACE_EXTRA_CATALOG_DIR`) read: what the catalogue
 * shows, this version's manifest as its `definition`, and its registration.
 * The manifest is the one `build` makes, checked the same way.
 *
 * The listing's picture is named by the path the deployment keeps it under,
 * which is the SHA-256 of its bytes, so it is uploaded beside the file
 * (`POST /api/v1/marketplace/local/media`). A deployment keeps PNG, JPEG, GIF
 * and WebP; any other picture is left out, and the listing shows the
 * deployment's default mark.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { bundler, compile, registrationOf } from "./build.js";
import type { Manifest } from "./contract.js";
import type { AnyApp } from "./define.js";

export interface PackOptions {
  /** The app's package directory. */
  root: string;
  /** The module whose default export is the app's definition, relative to `root`. */
  app: string;
  /** Where to write the listing file, relative to `root`. Default: `<publicId>-<version>.json`. */
  out?: string;
}

/** Where a deployment serves the pictures uploaded for its listings. */
const MEDIA_PATH = "/api/v1/marketplace/media/";
const KEPT_PICTURES = /\.(png|jpe?g|gif|webp)$/i;

/** The listing file, and the picture to upload beside it (null when it names none). */
export interface Packed {
  listing: Record<string, unknown>;
  avatar: Buffer | null;
}

/** The listing file for an app whose manifest `compile` made. */
export function listingFile(app: AnyApp, manifest: Manifest, root: string): Packed {
  const listing = app.listing;
  if (!listing) throw new Error("pack needs the app's listing: declare `listing` in its definition");
  const avatar = KEPT_PICTURES.test(listing.avatar) ? readFileSync(resolve(root, listing.avatar)) : null;
  // A deployment honours reference sectors only from a registry.
  const { reference_sectors: _sectors, ...registration } = registrationOf(app);
  return {
    avatar,
    listing: {
      uid: app.uid,
      public_id: app.publicId,
      kind: "app",
      name: app.name,
      publisher: listing.publisher,
      description: listing.summary,
      ...(listing.description !== undefined ? { long_description: listing.description } : {}),
      ...(avatar ? { avatar_url: `${MEDIA_PATH}${createHash("sha256").update(avatar).digest("hex")}` } : {}),
      version: listing.version,
      ...(listing.minAppVersion !== undefined ? { min_app_version: listing.minAppVersion } : {}),
      ...(listing.releaseNotes !== undefined ? { release_notes: listing.releaseNotes } : {}),
      definition: manifest,
      registration,
    },
  };
}

/** Write the app's listing file. Answers the process's exit code. */
export async function pack(options: PackOptions): Promise<number> {
  const esbuild = await bundler("pack");
  if (!esbuild) return 1;
  const root = resolve(options.root);
  const compiled = await compile(esbuild, root, options.app);
  if (compiled.problems) {
    for (const problem of compiled.problems) process.stderr.write(`${problem}\n`);
    return 1;
  }
  const { app } = compiled;
  let packed: Packed;
  try {
    packed = listingFile(app, compiled.manifest, root);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
  const { avatar: picture, version } = app.listing!;
  const path = resolve(root, options.out ?? `${app.publicId}-${version}.json`);
  writeFileSync(path, `${JSON.stringify(packed.listing, null, 2)}\n`);
  process.stdout.write(
    [
      `wrote ${relative(process.cwd(), path)}: ${app.publicId} ${version}, uid ${app.uid}`,
      packed.avatar
        ? `upload it with its picture, ${picture}, or run initiative-app dev --initiative <url> to do both`
        : `${picture} is not PNG, JPEG, GIF or WebP, so the listing shows the deployment's default mark`,
      "",
    ].join("\n")
  );
  return 0;
}
