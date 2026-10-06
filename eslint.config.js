import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.worker,
        ...globals.node,
        QRCodeStyling: "readonly",
        jsQR: "readonly",
        qrcode: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-undef": "error",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "off",
      "prefer-const": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // One unused-vars implementation per file kind: the TS rule understands
    // type positions (so the core rule must stay off there), and the core
    // rule is the one that understands plain JS catch params.
    files: ["**/*.ts"],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Service-worker scope: `self`/`caches` come from the worker globals, but
    // spell them out so a missing import can never hide behind ambient types.
    files: ["sw.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        caches: "readonly",
      },
    },
  },
  {
    // Vitest globals (describe/it/expect/vi) are injected by the runner with
    // `globals: true` — declare them instead of undef-erroring every test.
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "src/lib/**", "site/**", "coverage/**"],
  }
);
