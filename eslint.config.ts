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
      // Agent worktrees (untracked scratch checkouts) — not part of the workspace.
      ".claude/worktrees/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,
  prettier,
  // Project rules as gates (Rules 10, 60). The `no-restricted-syntax` selector
  // keys on the "use client" directive itself, so it catches server-only
  // imports in any client module wherever it lives. esquery regex literals
  // cannot contain `/`, hence `.` as the path separator.
  {
    rules: {
      "no-console": "error",
      "import/no-default-export": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@aws-sdk/*"],
              message:
                "Rule 10.5: the AWS SDK is allowed only in app/api/**, lib/data/**, lib/dynamodb.ts, apps/collector/** and scripts/**.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'Program:has(> ExpressionStatement[directive="use client"]) ImportDeclaration[source.value=/(^|.)lib.(data|dynamodb)(.|$)|^@aws-sdk./]',
          message:
            "Rule 10.1: Client Components never import lib/data/**, lib/dynamodb or @aws-sdk/* — pass data as props or fetch a Route Handler.",
        },
      ],
    },
  },
  {
    files: [
      "apps/dashboard/app/api/**",
      "apps/dashboard/lib/data/**",
      "apps/dashboard/lib/dynamodb.ts",
      "apps/collector/**",
      "scripts/**",
      "apps/dashboard/test/**",
      "**/*.test.{ts,tsx}",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  // Framework entry points and tool configs that require a default export
  // (Rule 60.5).
  {
    files: [
      "apps/dashboard/app/**/{page,layout,template,loading,error,global-error,not-found,default,route}.{ts,tsx}",
      "apps/dashboard/{proxy,auth}.ts",
      "**/*.config.{ts,mts,mjs,cjs,js}",
    ],
    rules: { "import/no-default-export": "off" },
  },
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
