import js from "@eslint/js";
import next from "eslint-config-next";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

// ESLint flat config (Rule 40 — flat config is the project standard).
// eslint-config-next ships a flat-config array; spread it directly. Prettier
// goes last to switch off formatting rules that conflict with Prettier.
export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
      "**/coverage/**",
      // CI helper scripts and the standalone simulator carry their own configs.
      ".github/**",
      "tools/**",
      // Vendored design-reference bundle (claude.ai/design export) — prototype
      // HTML/CSS/JS, not product code; recreated in our stack, never shipped.
      "docs/design-system/**",
      // Vendored shadcn/ui primitives and the generated mobile hook — upstream
      // code re-emitted by the shadcn CLI, not authored against our rules.
      "apps/dashboard/components/ui/**",
      "apps/dashboard/hooks/use-mobile.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,
  prettier,
  // CommonJS config files (e.g. commitlint.config.cjs) run under Node.
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "readonly",
        require: "readonly",
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
