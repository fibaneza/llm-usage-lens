import { defineConfig } from "vitest/config";

// Root Vitest config scoping the suite to the dashboard workspace (apps +
// packages) and keeping the standalone simulator out. Phase 3 extends this with
// React Testing Library setup and DynamoDB Local integration tests.
export default defineConfig({
  test: {
    include: [
      "apps/**/*.{test,spec}.{ts,tsx}",
      "packages/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["**/node_modules/**", "**/.next/**", "tools/**"],
  },
});
