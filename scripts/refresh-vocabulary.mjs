#!/usr/bin/env node
/**
 * Refresh the automation vocabulary this package is pinned to.
 *
 * The parameter and return terms an automation consumer can render are
 * published by `initiative-auto` and vendored here, because they are a fact
 * about what THAT service can draw. This pulls a newer copy and moves the pin.
 *
 *   node scripts/refresh-vocabulary.mjs --checkout ../initiative_auto
 *   node scripts/refresh-vocabulary.mjs --checkout ../initiative_auto --ref <sha>
 *   node scripts/refresh-vocabulary.mjs --checkout ../initiative_auto --check
 *
 * A CHECKOUT rather than a URL, matching how `initiative-auto` pins
 * Initiative's manifest schema: the document is generated from that service's
 * own constants, so reading it means reading the file that build produced —
 * and a git checkout is the only place a specific revision of it exists.
 *
 * Moving the pin is deliberate and is this package's call. A moving reference
 * would turn any change over there into a red build on an unrelated PR here,
 * which is the failure the pin exists to prevent.
 *
 * Run `npm run generate` afterwards: the schema and types are built from the
 * contract PLUS this file, so a refreshed vocabulary that has not been
 * regenerated is exactly the drift `npm test` fails on.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VOCABULARY = join(root, "schemas", "automation-vocabulary.json");
const REF = join(root, "schemas", "AUTOMATION_VOCABULARY_REF");

/** Where in that repository the published document lives. */
const PUBLISHED_AT = "backend/schemas/app-param-vocabulary.json";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const checkout = argument("--checkout");
if (!checkout) {
  process.stderr.write("usage: refresh-vocabulary.mjs --checkout <path to initiative_auto>\n");
  process.exit(2);
}

const git = (...args) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf-8" }).trim();

const ref = argument("--ref") ?? git("rev-parse", "HEAD");
const body = git("show", `${ref}:${PUBLISHED_AT}`) + "\n";

if (process.argv.includes("--check")) {
  const current = readFileSync(VOCABULARY, "utf-8");
  const pinned = readFileSync(REF, "utf-8").trim();
  if (current === body && pinned === ref) {
    process.stdout.write("the vendored vocabulary is current\n");
    process.exit(0);
  }
  process.stderr.write(
    "schemas/automation-vocabulary.json differs from the pinned revision — " +
      "run scripts/refresh-vocabulary.mjs and then npm run generate\n"
  );
  process.exit(1);
}

writeFileSync(VOCABULARY, body, "utf-8");
writeFileSync(REF, `${ref}\n`, "utf-8");
process.stdout.write(`vendored ${PUBLISHED_AT} at ${ref}\nnow run: npm run generate\n`);
