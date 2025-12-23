import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-eslint";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(
  {
    ignores: ["dist/**", "*.config.js"],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { tsconfigRootDir: __dirname, project: "./tsconfig.json" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
