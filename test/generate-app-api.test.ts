/**
 * `scripts/generate-app-api.mjs`: what it refuses in an app API document.
 */

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const script = fileURLToPath(new URL("../scripts/generate-app-api.mjs", import.meta.url));

it("fails on a parameter with neither a schema nor JSON content", async () => {
  const document = {
    info: { version: "0.0.0" },
    servers: [{ url: "/api/v1/c/0" }],
    paths: {
      "/tasks/": {
        get: {
          operationId: "list_tasks",
          "x-app-scope": "projects:read",
          parameters: [{ name: "conditions", in: "query" }],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };
  const server = createServer((_, response) => response.end(JSON.stringify(document)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const run = promisify(execFile)(process.execPath, [script, "--url", `http://127.0.0.1:${port}`]);
    await expect(run).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("list_tasks's query parameter conditions has neither a schema nor JSON content"),
    });
  } finally {
    server.close();
  }
});
