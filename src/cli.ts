#!/usr/bin/env node
/**
 * `initiative-app` — check a manifest before a deployment does.
 *
 * Two commands, both offline:
 *
 *   initiative-app validate <manifest.json>   what this side can check
 *   initiative-app schema                     print the schema it checks against
 *
 * `validate` exits non-zero on any problem, so it is worth a CI step. It does
 * not promise acceptance — the platform enforces byte-size caps and two
 * conditional rules that cannot be checked here — but every problem it reports
 * is a definite refusal.
 */

import { readFileSync } from "node:fs";
import { manifestSchema, validateDocument, validateManifest } from "./manifest.js";

function usage(): never {
  process.stderr.write(
    [
      "usage:",
      "  initiative-app validate <manifest.json>",
      "  initiative-app schema",
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

  // Both are called "the manifest", so take whichever was handed over rather
  // than insisting: a file carrying `definition` is a served document, anything
  // else is the manifest that goes inside one.
  const isDocument =
    typeof body === "object" && body !== null && "definition" in (body as Record<string, unknown>);

  const problems = isDocument ? validateDocument(body) : validateManifest(body);
  if (problems.length === 0) {
    process.stdout.write(
      isDocument
        ? `${path}: no problems found\n`
        : `${path}: no problems found (this is a manifest, not the document a ` +
            `registrar fetches — serve it as appDocument(manifest).)\n`
    );
    return 0;
  }
  for (const problem of problems) {
    process.stderr.write(`${path}${problem.where}: ${problem.message}\n`);
  }
  return 1;
}

process.exit(main(process.argv.slice(2)));
