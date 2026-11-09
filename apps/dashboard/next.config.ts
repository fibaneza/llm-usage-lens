import type { NextConfig } from "next";

// Disable Next.js anonymous telemetry — must be set before the config is
// evaluated so it takes effect at CLI startup (next dev / next build).
process.env.NEXT_TELEMETRY_DISABLED = "1";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
