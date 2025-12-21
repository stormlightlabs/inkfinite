// @ts-check

import eslint from "@eslint/js";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintPluginUnicorn.configs.recommended,
  [{
    rules: { "unicorn/no-null": "off", "unicorn/prevent-abbreviations": ["error", { "replacements": { "i": false } }] },
  }],
);
