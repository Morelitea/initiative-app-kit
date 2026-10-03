#!/usr/bin/env node
/**
 * Generate the typed client for Initiative's app API.
 *
 * Initiative describes every route an installed app may call in its own
 * OpenAPI document. This reads that document straight from Initiative and
 * writes `src/app-api.generated.ts`, nothing else:
 *
 * - `AppApiSchemas`, every schema the operations reach, and
 *   `AppApiOperations`, each operation's arguments by where they go and its
 *   answer, as TypeScript by the emitter the contract's types use
 *   (`ts-emit.mjs`);
 * - the operations table (`{ method, path, scope }` per operation id) and the
 *   `AppApi` methods `client.api` exposes.
 *
 * The document itself is never stored; the generated file's header names the
 * Initiative it came from. Regenerate when Initiative releases.
 *
 *   node scripts/generate-app-api.mjs --checkout ../initiative   # a local checkout (uv)
 *   node scripts/generate-app-api.mjs --release v0.75.0          # a release's attached asset
 *   node scripts/generate-app-api.mjs --url https://initiative.example.com
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { emitter } from "./ts-emit.mjs";

const RELEASES = "https://github.com/Morelitea/initiative/releases/download";
const ASSET = "initiative-app-api.json";
const SERVER = "/api/v1/c/0";
const METHODS = ["get", "put", "post", "delete", "patch"];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "src", "app-api.generated.ts");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited ${result.status}\n${result.stderr ?? ""}`);
  return result.stdout;
}

async function download(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) fail(`${url} answered ${response.status}`);
  return response.text();
}

/** The document and where it came from. */
async function source(argv) {
  const [flag, value, ...rest] = argv;
  if (!value || rest.length) fail("usage: generate-app-api.mjs --checkout <path> | --release <vX.Y.Z> | --url <base>");
  if (flag === "--checkout") {
    const checkout = resolve(value);
    const text = run("uv", ["run", "python", "scripts/export_openapi.py", "--app", "-"], {
      cwd: join(checkout, "backend"),
      stdio: ["ignore", "pipe", "inherit"],
    });
    const commit = run("git", ["-C", checkout, "rev-parse", "--short", "HEAD"]).trim();
    const dirty = run("git", ["-C", checkout, "status", "--porcelain"]).trim() ? ", with uncommitted changes" : "";
    return { text, from: `a checkout at ${commit}${dirty}` };
  }
  if (flag === "--release") {
    return { text: await download(`${RELEASES}/${encodeURIComponent(value)}/${ASSET}`), from: `release ${value}` };
  }
  if (flag === "--url") {
    const base = value.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
    return { text: await download(`${base}/api/v1/app-platform/openapi.json`), from: base };
  }
  fail(`unknown source ${flag}: use --checkout, --release or --url`);
}

const SCHEMAS = "#/components/schemas/";

const camel = (id) => id.replace(/_([a-z0-9])/g, (_, next) => next.toUpperCase());
const quote = (value) => JSON.stringify(value);

/** A JSON value as a TypeScript literal, keys unquoted where they can be. */
function valueLiteral(value) {
  if (Array.isArray(value)) return `[${value.map(valueLiteral).join(", ")}]`;
  if (value === null || typeof value !== "object") return quote(value);
  const entries = Object.entries(value).map(([key, one]) => `${/^[A-Za-z_]\w*$/.test(key) ? key : quote(key)}: ${valueLiteral(one)}`);
  return `{ ${entries.join(", ")} }`;
}

/** A description's first paragraph, as one line. */
const firstParagraph = (text) => text.split(/\n\s*\n/)[0].replace(/\s+/g, " ").replace(/``/g, "`").trim();

/** A schema reference is a member of `AppApiSchemas`. */
const { doc, objectType, tsType } = emitter({
  named: (node) => {
    if (node.$ref === undefined) return undefined;
    if (!node.$ref.startsWith(SCHEMAS)) fail(`cannot follow ${node.$ref}`);
    return `AppApiSchemas[${quote(node.$ref.slice(SCHEMAS.length))}]`;
  },
  prose: firstParagraph,
});

function scopeProse(scope) {
  if (typeof scope === "string") return `needs \`${scope}\``;
  if ("by" in scope) return `needs the scope its \`${scope.by}\` names`;
  return `needs one of ${scope.any_of.map((one) => `\`${one}\``).join(", ")}`;
}

/** Parameters in one place as an object schema, each described as its parameter is. */
function parameterObject(parameters) {
  return {
    type: "object",
    properties: Object.fromEntries(
      parameters.map((one) => [one.name, { ...one.schema, description: one.description ?? one.schema?.description }])
    ),
    required: parameters.filter((one) => one.required).map((one) => one.name),
  };
}

/** The types, the operations table and the `AppApi` class, from the document. */
function emit(spec) {
  const schemas = spec.components?.schemas ?? {};
  const shapes = [];
  const table = [];
  const methods = [];
  const names = new Map();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const verb of METHODS) {
      const operation = item[verb];
      if (!operation) continue;
      const id = operation.operationId;
      const scope = operation["x-app-scope"];
      if (!id || !scope) fail(`${verb.toUpperCase()} ${path} has no operationId or x-app-scope`);
      const name = camel(id);
      if (names.has(name)) fail(`${id} and ${names.get(name)} are both ${name}`);
      names.set(name, id);

      const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])];
      const inPath = parameters.filter((one) => one.in === "path");
      const inQuery = parameters.filter((one) => one.in === "query");
      if (typeof scope === "object" && "by" in scope && !inPath.some((one) => one.name === scope.by)) {
        fail(`${id} picks its scope by ${scope.by}, which is not a path parameter`);
      }

      const shape = [`  ${id}: {`];
      const fields = [];
      const op = `AppApiOperations[${quote(id)}]`;
      if (inPath.length) {
        shape.push(`    path: ${objectType(parameterObject(inPath), "    ")};`);
        fields.push(`path: ${op}["path"]`);
      }
      if (inQuery.length) {
        shape.push(`    query: ${objectType(parameterObject(inQuery), "    ")};`);
        fields.push(`query${inQuery.some((one) => one.required) ? "" : "?"}: ${op}["query"]`);
      }
      const body = operation.requestBody;
      if (body) {
        const json = body.content?.["application/json"];
        if (!json) fail(`${id} takes a body that is not JSON`);
        shape.push(`    body: ${tsType(json.schema ?? {}, "    ")};`);
        fields.push(`body${body.required ? "" : "?"}: ${op}["body"]`);
      }
      const status = Object.keys(operation.responses).filter((code) => /^2\d\d$/.test(code)).sort()[0];
      if (!status) fail(`${id} has no success response`);
      const content = operation.responses[status].content;
      const answer = !content
        ? "void"
        : content["application/json"]
          ? tsType(content["application/json"].schema ?? {}, "    ")
          : "Blob";
      shape.push(`    answer: ${answer};`, "  };");
      shapes.push(shape.join("\n"));

      const required = fields.some((field) => !/^\w+\?/.test(field));
      const args = fields.length ? `args${required ? "" : "?"}: { ${fields.join("; ")} }` : "";
      const prose = doc(operation.description ?? operation.summary, "  ").slice(0, -1);
      const route = `   * \`${verb.toUpperCase()} ${path}\`, ${scopeProse(scope)}.`;
      table.push(`  ${id}: ${valueLiteral({ method: verb.toUpperCase(), path, scope })},`);
      methods.push(
        [
          ...(prose.length ? [...prose, "   *", route] : ["  /**", route]),
          "   */",
          `  ${name}(${args}): Promise<${op}["answer"]> {`,
          `    return this.call(${quote(id)}${fields.length ? ", args" : ""}) as Promise<${op}["answer"]>;`,
          "  }",
        ].join("\n")
      );
    }
  }
  return `/** Initiative's schemas, by name: \`AppApiSchemas["TaskRead"]\`. */
export interface AppApiSchemas ${objectType({ properties: schemas, required: Object.keys(schemas) }, "")}

/** Each operation's arguments, by where they go, and its answer. */
export interface AppApiOperations {
${shapes.join("\n")}
}

/** Each operation an app may call: its method, its path after \`${SERVER}\`, and the scope it needs. */
export const appApiOperations = {
${table.join("\n")}
} as const satisfies Record<string, AppApiOperation>;

export type AppApiOperationId = keyof typeof appApiOperations;

/** Every route Initiative's app API describes, as a typed method. A client's \`api\` is one. */
export class AppApi {
  constructor(private readonly call: (operation: AppApiOperationId, args?: AppApiArgs) => Promise<unknown>) {}

${methods.join("\n\n")}
}
`;
}

const PREAMBLE = `import type { Scope } from "./contract.js";

/**
 * The scope an operation needs: one scope; the scope an argument picks
 * (\`by\`); or any one of several, when Initiative checks each item (\`per\`).
 */
export type AppApiScope =
  | Scope
  | { by: string; scopes: Readonly<Record<string, Scope>> }
  | { per: string; any_of: readonly Scope[] };

export interface AppApiOperation {
  method: "GET" | "PUT" | "POST" | "DELETE" | "PATCH";
  path: string;
  scope: AppApiScope;
}

export interface AppApiArgs {
  path?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
}
`;

const { text, from } = await source(process.argv.slice(2));
let spec;
try {
  spec = JSON.parse(text);
} catch {
  fail(`the app API document from ${from} is not JSON`);
}
if (spec.servers?.[0]?.url !== SERVER) fail(`expected the app API's server to be ${SERVER}, not ${spec.servers?.[0]?.url}`);

writeFileSync(
  output,
  `/**
 * Generated by scripts/generate-app-api.mjs from Initiative ${spec.info.version}'s app API
 * (${from}). Do not edit: regenerate.
 */

${PREAMBLE}
${emit(spec)}`
);
console.log(`wrote ${output} from Initiative ${spec.info.version} (${from})`);
