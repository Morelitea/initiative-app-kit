#!/usr/bin/env node
/**
 * Refresh the automation-block schema from a checkout of the automation service.
 *
 * Unlike `fetch-schema.mjs`, this one reads a **local checkout** rather than a
 * URL, and the copy IS committed here. Both differences have the same cause:
 * the automation service is a private repository, so there is no revision an
 * install of this package could fetch from.
 *
 * That makes the copy a genuine second location for one document, which is the
 * thing `fetch-schema.mjs` exists to avoid — so the parts that make drift
 * *visible* are what carry the weight here:
 *
 *   * the file is generated over there, from the constants that enforce it
 *     (`scripts/export_automation_schema.py`), never written by hand;
 *   * `--check` fails when this copy differs from that checkout, so refreshing
 *     is a command rather than a re-paste;
 *   * and the contract is versioned inside the document (`contract: 1`), so an
 *     app validating against a stale copy of an OLD contract still validates
 *     against a contract the service accepts.
 *
 *     node scripts/sync-automation-schema.mjs --checkout ../initiative_auto
 *     node scripts/sync-automation-schema.mjs --checkout ../initiative_auto --check
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const target = join(root, "schemas", "automation-block.json");

const args = process.argv.slice(2);
const checkoutIndex = args.indexOf("--checkout");
const checkout = checkoutIndex === -1 ? process.env.INITIATIVE_AUTO_CHECKOUT : args[checkoutIndex + 1];
const check = args.includes("--check");

if (!checkout) {
  process.stderr.write(
    "name the automation service's checkout:\n" +
      "    node scripts/sync-automation-schema.mjs --checkout ../initiative_auto\n" +
      "(or set INITIATIVE_AUTO_CHECKOUT)\n"
  );
  process.exit(1);
}

const source = resolve(checkout, "backend", "schemas", "automation-block.json");
if (!existsSync(source)) {
  process.stderr.write(`no schema at ${source} — is that the automation service's checkout?\n`);
  process.exit(1);
}

const body = readFileSync(source, "utf-8");
JSON.parse(body); // refuse to write something that is not a schema at all

if (check) {
  const current = existsSync(target) ? readFileSync(target, "utf-8") : "";
  if (current !== body) {
    process.stderr.write(
      "schemas/automation-block.json differs from the automation service's copy.\n" +
        "run this without --check to adopt it.\n"
    );
    process.exit(1);
  }
  process.stdout.write("schemas/automation-block.json is current\n");
  process.exit(0);
}

writeFileSync(target, body, "utf-8");
process.stdout.write(`synced schemas/automation-block.json from ${checkout}\n`);
