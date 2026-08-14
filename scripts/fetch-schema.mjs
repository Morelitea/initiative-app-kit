#!/usr/bin/env node
/**
 * Fetch the manifest schema from the Initiative revision this package pins.
 *
 * The schema is generated in the Initiative repository from the validator's own
 * vocabulary. This package does **not** keep a copy in git: a document that
 * exists in two repositories drifts, and a CI check that notices is still
 * drift — just supervised. What is in git here is a *version*, in `SCHEMA_REF`,
 * which is the ordinary way one project depends on another.
 *
 * So `schemas/app-manifest.json` is fetched by `prepare` (which npm runs on
 * install, including from a git URL) and bundled into the published package,
 * where it has to be present because `initiative-app validate` works offline.
 *
 * Moving to a newer contract is one line in `SCHEMA_REF`, and the diff a
 * reviewer sees is the version rather than a re-pasted document.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const target = join(root, "schemas", "app-manifest.json");

const ref = (process.env.INITIATIVE_SCHEMA_REF ?? readFileSync(join(root, "SCHEMA_REF"), "utf-8")).trim();
const source = `https://raw.githubusercontent.com/Morelitea/initiative/${ref}/backend/schemas/app-manifest.json`;

// A published tarball already carries the file; re-fetching on a consumer's
// install would make every install of this package depend on GitHub being up.
if (existsSync(target) && !process.argv.includes("--force")) {
  process.stdout.write("schemas/app-manifest.json is present\n");
  process.exit(0);
}

const response = await fetch(source).catch((error) => {
  process.stderr.write(`could not reach ${source}: ${error.message}\n`);
  process.exit(1);
});
if (!response.ok) {
  process.stderr.write(
    `could not fetch the manifest schema at ref '${ref}' (${response.status}).\n` +
      `check SCHEMA_REF, or set INITIATIVE_SCHEMA_REF to a revision that has it.\n`
  );
  process.exit(1);
}

const body = await response.text();
JSON.parse(body); // refuse to write something that is not a schema at all

mkdirSync(join(root, "schemas"), { recursive: true });
writeFileSync(target, body, "utf-8");
process.stdout.write(`fetched schemas/app-manifest.json from ${ref}\n`);
