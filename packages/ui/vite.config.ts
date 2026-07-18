import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [sveltekit()],
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{js,ts}"],
    exclude: ["e2e/**", "src/**/*.stories.{js,ts,svelte}"],
    setupFiles: ["./vitest.setup.ts"],
    watch: false,
  },
});
