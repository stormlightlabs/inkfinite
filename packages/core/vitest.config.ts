import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    ui: false,
    watch: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      thresholds: { lines: 75, functions: 75, branches: 75, statements: 75 },
      exclude: ["**/node_modules/**", "**/dist/**", "**/*.test.ts", "**/*.config.ts", "**/tests/**"],
    },
  },
});
