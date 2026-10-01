#!/usr/bin/env node
/**
 * Generate everything derived from `manifest.contract.json`.
 *
 * The contract is the one hand-authored statement of what an app manifest may
 * say: the vocabulary (enums, ladders, caps, character sets) and the shape (each
 * object's fields). Two things are generated from it and committed beside it:
 *
 * - `schemas/app-manifest.json` — the JSON Schema an author validates against.
 * - `src/contract.ts` — the same vocabulary and every object's shape as
 *   TypeScript, so no contract term exists without its type and the SDK's
 *   types cannot disagree with the schema it ships.
 *
 * Initiative vendors the contract itself rather than either output: it builds
 * its validator's constants from the vocabulary and holds its normalizer to the
 * field inventory.
 *
 * The transform is deliberately thin. A contract node is a schema node with the
 * repeated parts named instead of restated — `ref` for a `$ref`, an enum's name
 * for its values, a cap's name for its number, a character set's name for a
 * pattern — and everything else is carried through in the order it was written.
 *
 *   node scripts/generate.mjs           # write both
 *   node scripts/generate.mjs --check   # exit non-zero if either is stale
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(join(root, "manifest.contract.json"), "utf-8"));
const { charsets, enums, ladders, caps, defs, manifest } = contract;

/** Numbers reach the schema by the name the contract gives them. */
function resolveCap(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    if (!(value in caps)) throw new Error(`unknown cap '${value}'`);
    return caps[value];
  }
  if (value && typeof value === "object" && "wholeOf" in value) {
    const values = enums[value.wholeOf];
    if (!values) throw new Error(`unknown enum '${value.wholeOf}'`);
    // `plus` names a cap for what an open family adds beside the enum.
    return values.length + ("plus" in value ? resolveCap(value.plus) : 0);
  }
  throw new Error(`cannot resolve ${JSON.stringify(value)} as a cap`);
}

/** Caps named in prose, so raising one updates what it says about itself. */
const prose = (text) =>
  text.replace(/\{(\w+)\}/g, (whole, name) => (name in caps ? String(caps[name]) : whole));

/** Escape for use inside a regex character class. */
const escape = (character) =>
  ["\\", "]", "^", "-"].includes(character) ? `\\${character}` : character;

/** A class over exactly the set the contract allows, ordered so an unchanged
 *  vocabulary re-generates byte for byte. */
function charClass(name) {
  const set = charsets[name];
  if (set === undefined) throw new Error(`unknown character set '${name}'`);
  return `[${[...new Set(set)].sort().map(escape).join("")}]`;
}

function pattern(name, form, prefix = "") {
  const cls = charClass(name);
  // A literal prefix ahead of the class, such as a scope family's `apps:`.
  // Letters and colons only, so it needs no escaping inside a pattern.
  for (const character of prefix) {
    if (!"abcdefghijklmnopqrstuvwxyz:".includes(character)) {
      throw new Error(`pattern prefix '${prefix}' may hold only lowercase letters and ':'`);
    }
  }
  const lead = `^${prefix}`;
  if (form === "plus") return `${lead}${cls}+$`;
  if (form === "dotted") return `${lead}${cls}*\\.${cls}*$`;
  // A plain route: leading slash, and neither '//' nor '..'. The two refusals
  // are a lookahead rather than a second rule.
  if (form === "path") return `${lead}(?!.*(?://|\\.\\.))/${cls}*$`;
  throw new Error(`unknown pattern form '${form}'`);
}

const CAP_KEYWORDS = new Set([
  "maxItems", "minItems", "maxLength", "minLength",
  "maxProperties", "minProperties", "maximum", "minimum",
]);

/** One contract node as a schema node, key order preserved. */
function schemaNode(node) {
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "ref") out.$ref = `#/$defs/${value}`;
    else if (key === "enum") out.enum = typeof value === "string" ? enums[value] : value;
    else if (key === "patternFrom") {
      out.pattern = pattern(value, node.patternForm, node.patternPrefix);
    } else if (key === "patternForm" || key === "patternPrefix") continue;
    else if (CAP_KEYWORDS.has(key)) out[key] = resolveCap(value);
    else if (key === "description") out.description = prose(value);
    else if (key === "items" || key === "additionalProperties" || key === "propertyNames") {
      out[key] = typeof value === "object" && value !== null ? schemaNode(value) : value;
    } else if (key === "anyOf" || key === "oneOf" || key === "allOf") {
      out[key] = value.map((branch) => schemaNode(branch));
    } else if (key === "properties") {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, schemaNode(v)])
      );
    } else out[key] = value;
  }
  return out;
}

function buildSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: contract.schema.$id,
    title: contract.schema.title,
    description: prose(contract.schema.description),
    type: "object",
    required: manifest.required,
    properties: Object.fromEntries(
      Object.entries(manifest.properties).map(([k, v]) => [k, schemaNode(v)])
    ),
    $defs: Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, schemaNode(v)])),
  };
}

// --- TypeScript ------------------------------------------------------------

const pascal = (name) => name[0].toUpperCase() + name.slice(1);
const screaming = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
/** 'embedCapability' -> 'EMBED_CAPABILITIES', so the constant beside a type reads as English. */
const plural = (name) => (/[^aeiou]y$/.test(name) ? `${name.slice(0, -1)}ies` : `${name}s`);
const literal = (value) => (typeof value === "number" ? String(value) : JSON.stringify(value));

function buildTypes() {
  const lines = [
    "/**",
    " * The app contract, as TypeScript.",
    " *",
    " * GENERATED from `manifest.contract.json` by `scripts/generate.mjs`. Do not",
    " * edit it: change the contract and run `npm run generate`.",
    " *",
    " * These are the enums, caps and character sets the bundled JSON Schema is built",
    " * from, and the shape of every object it defines, so this package's types",
    " * cannot describe a manifest the schema refuses, nor miss a term it allows.",
    " */",
    "",
  ];

  for (const [name, values] of Object.entries(enums)) {
    lines.push(
      `export type ${pascal(name)} = ${values.map(literal).join(" | ")};`,
      `export const ${screaming(plural(name))}: readonly ${pascal(name)}[] = [${values.map(literal).join(", ")}];`,
      ""
    );
  }

  for (const [name, rungs] of Object.entries(ladders)) {
    lines.push(
      `/** The ${name} rungs, lowest first: a value names the floor an audience must clear. */`,
      `export const ${screaming(name)}_LADDER: readonly ${pascal(name)}[] = [${rungs.map(literal).join(", ")}];`,
      ""
    );
  }

  lines.push(
    "/** Every cap the platform enforces, by the name the contract gives it. */",
    "export const CAPS = {"
  );
  for (const [name, value] of Object.entries(caps)) lines.push(`  ${name}: ${value},`);
  lines.push("} as const;", "");

  lines.push(
    "/** The character sets ids and paths are drawn from. */",
    "export const CHARSETS = {"
  );
  for (const [name, set] of Object.entries(charsets)) {
    lines.push(`  ${name}: ${JSON.stringify(set)},`);
  }
  lines.push("} as const;", "");

  lines.push(
    "/**",
    " * Every field the contract declares, by the object that owns it.",
    " *",
    " * The inventory the platform holds its normalizer to, exported so a consumer",
    " * can enumerate what a manifest may carry without parsing the schema.",
    " */",
    "export const FIELDS = {"
  );
  const owners = { ...defs, manifest: { properties: manifest.properties } };
  for (const [owner, shape] of Object.entries(owners)) {
    if (!shape.properties) continue;
    lines.push(`  ${owner}: [${Object.keys(shape.properties).map((k) => JSON.stringify(k)).join(", ")}],`);
  }
  lines.push("} as const;", "");

  for (const [name, node] of Object.entries(defs)) lines.push(...declaration(name, node), "");
  lines.push(
    ...declaration("manifest", { type: "object", ...manifest, description: contract.schema.description })
  );
  return lines.join("\n");
}

/**
 * Where the contract leaves an object open but says what its values are. Local
 * text is keyed by language tag and its values should be strings; the schema
 * cannot say so without refusing what the platform only ignores.
 */
const OPEN_OBJECTS = { localizedText: "Record<string, string>" };

/** A JSDoc block, wrapped to the width the rest of the file uses. */
function doc(text, indent) {
  if (!text) return [];
  const words = prose(text).replaceAll("*/", "* /").split(/\s+/);
  const out = [];
  let line = "";
  for (const word of words) {
    if (line && `${indent} * ${line} ${word}`.length > 80) {
      out.push(`${indent} * ${line}`);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(`${indent} * ${line}`);
  return [`${indent}/**`, ...out, `${indent} */`];
}

/** One def as a named type: an interface for an object with fields, an alias otherwise. */
function declaration(name, node) {
  const lines = doc(node.description, "");
  if (name in OPEN_OBJECTS) {
    lines.push(`export type ${pascal(name)} = ${OPEN_OBJECTS[name]};`);
  } else if (node.type === "object" && node.properties) {
    lines.push(`export interface ${pascal(name)} ${objectType(node, "")}`);
  } else {
    lines.push(`export type ${pascal(name)} = ${tsType(node, "")};`);
  }
  return lines;
}

/** An object's fields, in the order the contract writes them. */
function objectType(node, indent) {
  const required = new Set(node.required ?? []);
  const lines = ["{"];
  for (const [key, child] of Object.entries(node.properties)) {
    lines.push(...doc(child.description, `${indent}  `));
    lines.push(`${indent}  ${key}${required.has(key) ? "" : "?"}: ${tsType(child, `${indent}  `)};`);
  }
  lines.push(`${indent}}`);
  return lines.join("\n");
}

const PRIMITIVES = { string: "string", integer: "number", number: "number", boolean: "boolean" };

/** One contract node as a TypeScript type. */
function tsType(node, indent) {
  if (node.ref) return pascal(node.ref);
  if ("const" in node) return literal(node.const);
  if (node.enum) {
    return typeof node.enum === "string" ? pascal(node.enum) : node.enum.map(literal).join(" | ");
  }
  const branches = node.anyOf ?? (node.properties ? undefined : node.oneOf);
  if (branches) return branches.map((branch) => tsType(branch, indent)).join(" | ");
  if (Array.isArray(node.type)) return node.type.map((type) => PRIMITIVES[type]).join(" | ");
  if (node.type === "array") {
    const item = tsType(node.items, indent);
    return /[ |]/.test(item) ? `Array<${item}>` : `${item}[]`;
  }
  if (node.type === "object") {
    if (node.properties) return objectType(node, indent);
    const values = node.additionalProperties;
    return `Record<string, ${typeof values === "object" ? tsType(values, indent) : "unknown"}>`;
  }
  if (node.type === "string" && node.patternPrefix) return `\`${node.patternPrefix}\${string}\``;
  const primitive = PRIMITIVES[node.type];
  if (!primitive) throw new Error(`no TypeScript type for ${JSON.stringify(node)}`);
  return primitive;
}

// --- write or check --------------------------------------------------------

const outputs = [
  [join(root, "schemas", "app-manifest.json"), JSON.stringify(buildSchema(), null, 2) + "\n"],
  [join(root, "src", "contract.ts"), buildTypes()],
];

const checking = process.argv.includes("--check");
let stale = false;
for (const [path, body] of outputs) {
  let current = null;
  try { current = readFileSync(path, "utf-8"); } catch { /* not written yet */ }
  if (current === body) continue;
  if (checking) {
    process.stderr.write(`${path} is out of date — run 'npm run generate'\n`);
    stale = true;
  } else {
    writeFileSync(path, body, "utf-8");
    process.stdout.write(`wrote ${path}\n`);
  }
}
if (stale) process.exit(1);
if (checking) process.stdout.write("generated files are current\n");
