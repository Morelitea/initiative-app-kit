import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("npm test rejects a name filter that executes nothing", () => {
  const result = spawnSync(
    "npm",
    ["test", "--", "--testNamePattern=__definitely_no_test_matches__"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: process.env,
    },
  );
  const output = `${result.stdout}${result.stderr}`;

  assert.notEqual(result.status, 0, output);
  assert.match(output, /executed none of them/);
});
