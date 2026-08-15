#!/usr/bin/env node
/**
 * `initiative-app` — check a manifest before a deployment does.
 *
 * Three commands, all offline:
 *
 *   initiative-app validate <file.json>   a manifest, a document, or a listing
 *   initiative-app schema                 print the schema it checks against
 *   initiative-app uid                    mint a catalog uid
 *
 * `validate` exits non-zero on any problem, so it is worth a CI step. It does
 * not promise acceptance — the platform enforces byte-size caps and two
 * conditional rules that cannot be checked here — but every problem it reports
 * is a definite refusal.
 */

import { readFileSync } from "node:fs";
import { mintUid, validateListing } from "./listing.js";
import { manifestSchema, validateDocument, validateManifest } from "./manifest.js";

function usage(): never {
  process.stderr.write(
    [
      "usage:",
      "  initiative-app validate <file.json>   a manifest, a document, or a listing",
      "  initiative-app schema",
      "  initiative-app uid",
      "",
    ].join("\n")
  );
  process.exit(2);
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;

  if (command === "schema") {
    process.stdout.write(`${JSON.stringify(manifestSchema(), null, 2)}\n`);
    return 0;
  }

  if (command === "uid") {
    // Mint once and write it into your source. It is immutable and never
    // reused, so re-running this for an app you have already published creates
    // a second listing rather than updating the first.
    process.stdout.write(`${mintUid()}\n`);
    return 0;
  }

  if (command !== "validate") usage();
  const path = rest[0];
  if (!path) usage();

  let body: unknown;
  try {
    body = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    process.stderr.write(`${path}: ${(error as Error).message}\n`);
    return 1;
  }

  // Three shapes share this command, because in practice you have a file and
  // want to know whether it is good — not to first classify it yourself. A
  // `kind` of app/dashboard alongside a version is a catalog listing; anything
  // else carrying `definition` is a served document; the rest is a manifest.
  const record =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const shape =
    "version" in record && (record.kind === "app" || record.kind === "dashboard")
      ? "listing"
      : "definition" in record
        ? "document"
        : "manifest";

  const problems =
    shape === "listing"
      ? validateListing(body)
      : shape === "document"
        ? validateDocument(body)
        : validateManifest(body);

  if (problems.length === 0) {
    const note =
      shape === "manifest"
        ? " (this is a manifest, not the document a registrar fetches — serve it" +
          " as appDocument(manifest), and publish it with appListing().)"
        : shape === "document"
          ? " (this is the document a registrar fetches. Publishing it so a guild" +
            " can install it is a separate file — see appListing().)"
          : "";
    process.stdout.write(`${path}: no problems found${note}\n`);
    return 0;
  }
  for (const problem of problems) {
    process.stderr.write(`${path}${problem.where}: ${problem.message}\n`);
  }
  return 1;
}

process.exit(main(process.argv.slice(2)));
