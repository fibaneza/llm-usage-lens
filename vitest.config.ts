import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Root Vitest config scoping the suite to the dashboard workspace (apps +
// packages) and keeping the standalone simulator out. The React plugin and
// jsdom environment support component tests (React Testing Library); Phase 3
// extends this with DynamoDB Local integration tests, which may split the env
// per project (data-access tests run under node).
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirror the dashboard tsconfig "@/*" path alias for component tests.
    alias: {
      "@": fileURLToPath(new URL("./apps/dashboard", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./apps/dashboard/vitest.setup.ts"],
    include: [
      "apps/**/*.{test,spec}.{ts,tsx}",
      "packages/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["**/node_modules/**", "**/.next/**", "tools/**"],
  },
});
