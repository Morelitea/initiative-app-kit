/**
 * `initiative-app init [dir] [--example minimal]`: a new app, copied from one
 * of the SDK's examples, with a uid of its own and its package named after its
 * directory.
 */

import { randomInt } from "node:crypto";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CAPS, CHARSETS } from "./contract.js";

/** Where the examples ship, beside `dist` in the package and `src` in the repo. */
const EXAMPLES = fileURLToPath(new URL("../examples/", import.meta.url));

/** A fresh catalog uid, in Crockford base32. Mint once, write it into the app, never change it. */
export function mintUid(): string {
  let uid = "";
  for (let index = 0; index < CAPS.uidLength; index += 1) uid += CHARSETS.uid[randomInt(CHARSETS.uid.length)];
  return uid;
}

export interface InitOptions {
  /** The new app's directory: absent or empty. */
  dir: string;
  example: string;
}

/** Copy the example. Answers the process's exit code. */
export function init(options: InitOptions): number {
  const examples = readdirSync(EXAMPLES);
  if (!examples.includes(options.example)) {
    process.stderr.write(`there is no example ${options.example}; there is ${examples.join(", ")}\n`);
    return 2;
  }
  const dir = resolve(options.dir);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    process.stderr.write(`${dir} is not empty; choose a new directory\n`);
    return 1;
  }
  cpSync(join(EXAMPLES, options.example), dir, {
    recursive: true,
    filter: (path) => !/[\\/]node_modules$/.test(path),
  });

  const uid = mintUid();
  const appPath = join(dir, "src", "app.ts");
  writeFileSync(appPath, readFileSync(appPath, "utf-8").replace(/uid: "[0-9A-Z]+"/, `uid: "${uid}"`));
  const packagePath = join(dir, "package.json");
  const manifest = JSON.parse(readFileSync(packagePath, "utf-8")) as Record<string, unknown>;
  // npm's rule for a package name: lowercase, and no character a URL would escape.
  const name = basename(dir).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+/, "") || "app";
  writeFileSync(packagePath, `${JSON.stringify({ ...manifest, name }, null, 2)}\n`);

  const where = relative(process.cwd(), dir) || ".";
  process.stdout.write(
    [
      `created ${where} from the ${options.example} example, uid ${uid}`,
      `next: cd ${where} && npm install && npm test`,
      "",
    ].join("\n")
  );
  return 0;
}
