import { sveltekit } from "@sveltejs/kit/vite";
import { playwright } from "@vitest/browser-playwright";
import devtoolsJson from "vite-plugin-devtools-json";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [sveltekit(), devtoolsJson()],
  test: {
    ui: false,
    watch: false,
    expect: { requireAssertions: true },
    projects: [{
      extends: "./vite.config.ts",
      test: {
        name: "client",
        browser: {
          headless: true,
          enabled: true,
          provider: playwright(),
          instances: [{ browser: "chromium", headless: true }],
        },
        include: ["src/**/*.svelte.{test,spec}.{js,ts}", "src/lib/tests/**/*.{test,spec}.{js,ts}"],
        exclude: ["src/lib/server/**"],
      },
    }, {
      extends: "./vite.config.ts",
      test: {
        name: "server",
        environment: "node",
        include: ["src/**/*.{test,spec}.{js,ts}"],
        exclude: ["src/**/*.svelte.{test,spec}.{js,ts}", "src/lib/tests/**/*.{test,spec}.{js,ts}"],
      },
    }],
  },
});
