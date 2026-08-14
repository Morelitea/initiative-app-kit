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
import { validateManifest, manifestSchema } from "./manifest.js";

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

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    process.stderr.write(`${path}: ${(error as Error).message}\n`);
    return 1;
  }

  const problems = validateManifest(manifest);
  if (problems.length === 0) {
    process.stdout.write(`${path}: no problems found\n`);
    return 0;
  }
  for (const problem of problems) {
    process.stderr.write(`${path}${problem.where}: ${problem.message}\n`);
  }
  return 1;
}

process.exit(main(process.argv.slice(2)));
