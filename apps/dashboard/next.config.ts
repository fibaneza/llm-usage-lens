import { fileURLToPath } from "node:url";

import { initialEnv, updateInitialEnv } from "@next/env";
import type { NextConfig } from "next";

import { parseBasePath } from "./lib/base-path";
import { applyAppEnvFile } from "./lib/env-files";

// Disable Next.js anonymous telemetry — must be set before the config is
// evaluated so it takes effect at CLI startup (next dev / next build).
process.env.NEXT_TELEMETRY_DISABLED = "1";

// Layer `.env.<APP_ENV>` over Next's .env loading (implementation-phases spec —
// Environment Files). Registering the values as initial env keeps them across
// Next's dev-time .env reloads. Skipped under test, like Next's `.env.local`.
if (process.env.NODE_ENV !== "test") {
  updateInitialEnv(
    applyAppEnvFile({
      dir: fileURLToPath(new URL(".", import.meta.url)),
      processEnv: process.env,
      initialEnv,
    }),
  );
}

// Platform spec — Runtime (response security headers); no includeSubDomains.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Platform spec - Base path (BP-D1, BP-D2): build-time, optional. The
  // Dockerfile skips env validation, so the value is validated here.
  basePath: parseBasePath(process.env.NEXT_PUBLIC_BASE_PATH),
  // The role-probe e2e server builds into its own dir so it never clashes with
  // the main dev server's .next (tool config; Rule 50.2).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  headers: async () => [{ source: "/:path*", headers: SECURITY_HEADERS }],
  // Self-contained server bundle for the ECS container image; the tracing root
  // is the monorepo root so the workspace package is traced.
  // See docs/specs/2026-11-10-platform.md — Runtime.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // Compile the workspace package from its TypeScript source (it ships .ts,
  // not a build artifact). See docs/specs/2026-05-15-system-architecture.md —
  // "Shared code layout".
  transpilePackages: ["@llm-usage-lens/shared"],
  // The headless Playwright harness loads the dev server via 127.0.0.1; without
  // this Next blocks the dev resources and the page never hydrates (Rule 70.11).
  allowedDevOrigins: ["127.0.0.1"],
  // The dev indicator defaults to bottom-left, where it covers the collapsed
  // sidebar rail's footer toggle and intercepts its pointer events (dev only).
  devIndicators: { position: "bottom-right" },
  // Agent guidance is CLAUDE.md and .claude/rules; tool-injected agent files are not accepted.
  agentRules: false,
  // E2E dev servers only (tool config; Rule 50.2): a reused Turbopack dev FS
  // cache panics "task ... is missing in memory or persistent storage" (2026-11-24).
  ...(process.env.E2E_DEV_NO_FS_CACHE === "1"
    ? { experimental: { turbopackFileSystemCacheForDev: false } }
    : {}),
};

export default nextConfig;
