#!/usr/bin/env node
/**
 * `initiative-app`: build an app's files, and keys and manifest checks.
 *
 *   initiative-app build [--app <file>] [--registry <dir>] [--check]
 *   initiative-app keygen [--alg RS256|ES256] [--kid <id>] [--out <dir>]
 *   initiative-app validate <file.json>   a manifest, or a served manifest document
 *   initiative-app schema                 print the schema a manifest is checked against
 *   initiative-app uid                    mint a catalog uid
 *
 * `build` reads the app's definition (default `src/app.ts`) and writes
 * `manifest.json`, and with `--registry` the app's registry source; see
 * `build.ts`. `keygen` writes `private-key.pem` (mode 0600) and `jwks.json`
 * into `--out` and refuses to overwrite either.
 */

import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { build } from "./build.js";
import { CAPS, CHARSETS } from "./contract.js";
import { generateAppKeys, type AppKeyAlgorithm } from "./keys.js";
import { manifestSchema, validateDocument, validateManifest } from "./validate.js";

function usage(): never {
  process.stderr.write(
    [
      "usage:",
      "  initiative-app build [--app <file>] [--registry <dir>] [--check]",
      "  initiative-app keygen [--alg RS256|ES256] [--kid <id>] [--out <dir>]",
      "  initiative-app validate <file.json>",
      "  initiative-app schema",
      "  initiative-app uid",
      "",
    ].join("\n")
  );
  process.exit(2);
}

/** `--name value` pairs and the `--name` switches in `switches`, and nothing else. */
function flags(args: string[], values: string[], switches: string[] = []): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index].startsWith("--") ? args[index].slice(2) : "";
    if (switches.includes(name)) {
      out[name] = true;
    } else if (values.includes(name) && args[index + 1] !== undefined) {
      out[name] = args[index + 1];
      index += 1;
    } else usage();
  }
  return out;
}

function keygen(args: string[]): number {
  const options = flags(args, ["alg", "kid", "out"]) as Record<string, string>;
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
      `wrote ${jwksPath} (the public half, for the app's listing or a deployment's operator)`,
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
  // A served document carries the manifest as its `definition`.
  const document = typeof body === "object" && body !== null && "definition" in body;
  const problems = document ? validateDocument(body) : validateManifest(body);
  if (problems.length === 0) {
    process.stdout.write(`${path}: no problems found (checked as a ${document ? "document" : "manifest"})\n`);
    return 0;
  }
  for (const problem of problems) process.stderr.write(`${path}${problem.where}: ${problem.message}\n`);
  return 1;
}

/** A fresh catalog uid, in Crockford base32. Mint once, write it into the app, never change it. */
function mintUid(): string {
  let uid = "";
  for (let index = 0; index < CAPS.uidLength; index += 1) uid += CHARSETS.uid[randomInt(CHARSETS.uid.length)];
  return uid;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "build": {
      const options = flags(rest, ["app", "registry"], ["check"]);
      return build({
        root: process.cwd(),
        app: typeof options.app === "string" ? options.app : "src/app.ts",
        ...(typeof options.registry === "string" ? { registry: options.registry } : {}),
        check: options.check === true,
      });
    }
    case "keygen":
      return keygen(rest);
    case "validate":
      return validate(rest[0]);
    case "schema":
      process.stdout.write(`${JSON.stringify(manifestSchema(), null, 2)}\n`);
      return 0;
    case "uid":
      process.stdout.write(`${mintUid()}\n`);
      return 0;
    default:
      usage();
  }
}

process.exit(await main(process.argv.slice(2)));
