import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import("@sveltejs/kit").Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ fallback: "index.html" }),
    prerender: { entries: ["/"] },
    alias: {
      "$editor": "../../packages/ui/src/lib/editor",
      "@inkfinite/ui/editor": "../../packages/ui/src/lib/editor/index.ts",
    },
  },
};

export default config;
