import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@inkfinite/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)) } },
  test: { environment: "jsdom", globals: true, ui: false, watch: false },
});
