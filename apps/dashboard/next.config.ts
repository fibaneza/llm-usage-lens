import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compile the workspace package from its TypeScript source (it ships .ts,
  // not a build artifact). See docs/specs/2026-05-15-system-architecture.md —
  // "Shared code layout".
  transpilePackages: ["@bedrock-usage/shared"],
};

export default nextConfig;
