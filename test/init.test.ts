/**
 * `initiative-app init`: an example copied into a new directory, with a uid of
 * its own and its package named after the directory.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHARSETS } from "../src/contract.js";
import { init } from "../src/init.js";

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, "..", "examples", "minimal");

let parent: string;
let errors: string[];

beforeEach(() => {
  parent = mkdtempSync(join(here, ".build-"));
  errors = [];
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errors.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(parent, { recursive: true, force: true });
});

const uidOf = (path: string) => /uid: "([^"]+)"/.exec(readFileSync(path, "utf-8"))![1];

describe("init", () => {
  it("copies the example with a fresh uid, its package named after the directory", () => {
    const dir = join(parent, "My App");
    expect(init({ dir, example: "minimal" })).toBe(0);
    const uid = uidOf(join(dir, "src", "app.ts"));
    expect(uid).not.toBe(uidOf(join(example, "src", "app.ts")));
    expect([...uid].every((char) => CHARSETS.uid.includes(char))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")).name).toBe("my-app");
    expect(readFileSync(join(dir, "src", "app.ts"), "utf-8").replace(uid, "")).toBe(
      readFileSync(join(example, "src", "app.ts"), "utf-8").replace(uidOf(join(example, "src", "app.ts")), "")
    );
    expect(readFileSync(join(dir, "assets", "avatar.png"))).toEqual(readFileSync(join(example, "assets", "avatar.png")));
  });

  it("refuses a directory that is not empty, and an example there is not", () => {
    mkdirSync(join(parent, "taken"));
    writeFileSync(join(parent, "taken", "notes.md"), "mine");
    expect(init({ dir: join(parent, "taken"), example: "minimal" })).toBe(1);
    expect(errors.join("")).toContain("is not empty");
    expect(init({ dir: join(parent, "new"), example: "huge" })).toBe(2);
    expect(errors.join("")).toContain("there is no example huge; there is minimal");
  });
});
