import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The examples import the SDK by its package name, as an app does; in this
// repository that name is the source.
export default defineConfig({
  resolve: {
    alias: [{ find: /^initiative-app-sdk\/(.*)$/, replacement: fileURLToPath(new URL("./src/$1.ts", import.meta.url)) }],
  },
});
