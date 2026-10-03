/**
 * JSON Schema as TypeScript, shared by the generators: the manifest contract's
 * types (`generate.mjs`) and the app API's (`generate-app-api.mjs`).
 *
 * Each caller says what its own schemas name and how its prose reads:
 *
 * - `named(node)` answers the type a node stands for by name (a reference, a
 *   named enum), or undefined to build it from its keywords;
 * - `prose(text)` turns a description into the words its doc comment holds.
 *
 * An object's fields are optional unless its `required` list names them; a
 * default alone makes nothing required.
 */

export const pascal = (name) => name[0].toUpperCase() + name.slice(1);
export const literal = (value) => (typeof value === "number" ? String(value) : JSON.stringify(value));

const PRIMITIVES = { string: "string", integer: "number", number: "number", boolean: "boolean", null: "null" };

export function emitter({ named = () => undefined, prose = (text) => text } = {}) {
  /** A JSDoc block, wrapped to the width the rest of the file uses. */
  function doc(text, indent) {
    const said = text && prose(text);
    if (!said) return [];
    const words = said.replaceAll("*/", "* /").split(/\s+/);
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

  /** An object's fields, in the order the schema writes them. */
  function objectType(node, indent) {
    const required = new Set(node.required ?? []);
    const lines = ["{"];
    for (const [key, child] of Object.entries(node.properties)) {
      const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
      lines.push(...doc(child.description, `${indent}  `));
      lines.push(`${indent}  ${name}${required.has(key) ? "" : "?"}: ${tsType(child, `${indent}  `)};`);
    }
    lines.push(`${indent}}`);
    return lines.join("\n");
  }

  /** One schema node as a TypeScript type. */
  function tsType(node, indent) {
    const name = named(node);
    if (name !== undefined) return name;
    if ("const" in node) return literal(node.const);
    if (node.enum) return node.enum.map(literal).join(" | ");
    const branches = node.anyOf ?? (node.properties ? undefined : node.oneOf);
    if (branches) return branches.map((branch) => tsType(branch, indent)).join(" | ");
    if (Array.isArray(node.type)) return node.type.map((type) => PRIMITIVES[type]).join(" | ");
    if (node.type === "array") {
      const item = node.items ? tsType(node.items, indent) : "unknown";
      return /[ |]/.test(item) ? `Array<${item}>` : `${item}[]`;
    }
    if (node.type === "object" || (node.type === undefined && node.properties)) {
      if (node.properties) return objectType(node, indent);
      const values = node.additionalProperties;
      return `Record<string, ${typeof values === "object" ? tsType(values, indent) : "unknown"}>`;
    }
    // A node that says nothing of its type holds any value.
    if (node.type === undefined) return "unknown";
    const primitive = PRIMITIVES[node.type];
    if (!primitive) throw new Error(`no TypeScript type for ${JSON.stringify(node)}`);
    return primitive;
  }

  return { doc, objectType, tsType };
}
