#!/usr/bin/env node
/**
 * `initiative-app` — keys and manifest checks, all offline.
 *
 *   initiative-app keygen [--alg RS256|ES256] [--kid <id>] [--out <dir>]
 *   initiative-app validate <file.json>   a manifest, a document, or a listing
 *   initiative-app schema                 print the schema it checks against
 *   initiative-app uid                    mint a catalog uid
 *
 * `keygen` writes `private-key.pem` (mode 0600) and `jwks.json` into `--out`
 * (default: the current directory) and refuses to overwrite either. Keep the
 * private key with your app; give `jwks.json` to your deployment's operator.
 *
 * `validate` exits non-zero on any problem, so it is worth a CI step. The
 * platform also enforces byte-size caps and a conditional rule that cannot be
 * checked here.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { generateAppKeys, type AppKeyAlgorithm } from "./keys.js";
import { mintUid, validateListing } from "./listing.js";
import { manifestSchema, validateDocument, validateManifest } from "./manifest.js";

function usage(): never {
  process.stderr.write(
    [
      "usage:",
      "  initiative-app keygen [--alg RS256|ES256] [--kid <id>] [--out <dir>]",
      "  initiative-app validate <file.json>   a manifest, a document, or a listing",
      "  initiative-app schema",
      "  initiative-app uid",
      "",
    ].join("\n")
  );
  process.exit(2);
}

/** `--name value` pairs, and nothing else. */
function flags(args: string[], allowed: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name.startsWith("--") || !allowed.includes(name.slice(2)) || value === undefined) {
      usage();
    }
    out[name.slice(2)] = value;
  }
  return out;
}

function keygen(args: string[]): number {
  const options = flags(args, ["alg", "kid", "out"]);
  const alg = (options.alg ?? "RS256") as AppKeyAlgorithm;
  if (alg !== "RS256" && alg !== "ES256") {
    process.stderr.write(`unsupported --alg ${alg}: use RS256 or ES256\n`);
    return 2;
  }
  const dir = options.out ?? ".";
  const keyPath = join(dir, "private-key.pem");
  const jwksPath = join(dir, "jwks.json");
  for (const path of [keyPath, jwksPath]) {
    if (existsSync(path)) {
      process.stderr.write(`${path} already exists; choose another --out\n`);
      return 1;
    }
  }

  const keys = generateAppKeys({ alg, ...(options.kid ? { kid: options.kid } : {}) });
  mkdirSync(dir, { recursive: true });
  writeFileSync(keyPath, keys.privateKeyPem, { mode: 0o600, flag: "wx" });
  writeFileSync(jwksPath, `${JSON.stringify(keys.jwks, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(
    [
      `wrote ${keyPath} (keep it secret)`,
      `wrote ${jwksPath} (give it to your deployment's operator)`,
      `kid: ${keys.kid}`,
      `alg: ${keys.alg}`,
      "",
    ].join("\n")
  );
  return 0;
}

function validate(path: string | undefined): number {
  if (!path) usage();

  let body: unknown;
  try {
    body = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    process.stderr.write(`${path}: ${(error as Error).message}\n`);
    return 1;
  }

  // A `kind` of app/dashboard beside a version is a catalog listing; anything
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
    process.stdout.write(`${path}: no problems found (checked as a ${shape})\n`);
    return 0;
  }
  for (const problem of problems) {
    process.stderr.write(`${path}${problem.where}: ${problem.message}\n`);
  }
  return 1;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  switch (command) {
    case "keygen":
      return keygen(rest);
    case "validate":
      return validate(rest[0]);
    case "schema":
      process.stdout.write(`${JSON.stringify(manifestSchema(), null, 2)}\n`);
      return 0;
    case "uid":
      // Mint once and write it into your source: a uid is immutable and never
      // reused.
      process.stdout.write(`${mintUid()}\n`);
      return 0;
    default:
      usage();
  }
}

process.exit(main(process.argv.slice(2)));
