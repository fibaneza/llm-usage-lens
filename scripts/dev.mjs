#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ST1 D-ST1 (docs/guides/auth-setup.md): print the app URL with the base path,
// then start `next dev`. Rule 50.2: scripts/** read process.env directly.
// Next loads .env* from the app directory, not the repo root, so load them the
// same way before reading the variables. @next/env resolves from the dashboard
// workspace (no root dependency).
export function loadDashboardEnv(rootDir) {
  const here = dirname(fileURLToPath(import.meta.url));
  const requireFromDashboard = createRequire(
    join(here, "..", "apps", "dashboard", "package.json"),
  );
  const { loadEnvConfig } = requireFromDashboard("@next/env");
  // The third argument is the log object; a no-op keeps `pnpm dev` quiet.
  loadEnvConfig(
    join(rootDir, "apps", "dashboard"),
    true,
    { info() {}, error() {} },
    true,
  );
  return process.env;
}

// The prefix is a whole path segment sequence, never a raw string suffix.
function endsWithSegments(url, basePath) {
  const prefix = basePath.split("/").filter(Boolean);
  if (prefix.length === 0) return false;
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  const segments = path.split("/").filter(Boolean);
  const tail = segments.slice(segments.length - prefix.length);
  return tail.length === prefix.length && tail.every((s, i) => s === prefix[i]);
}

export function buildLocalLine(env) {
  const url = (env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const basePath = env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `Local: ${basePath && endsWithSegments(url, basePath) ? url : url + basePath}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${buildLocalLine(
      loadDashboardEnv(join(dirname(fileURLToPath(import.meta.url)), "..")),
    )}\n`,
  );
  const child = spawn(
    "pnpm",
    ["--dir", "apps/dashboard", "exec", "next", "dev"],
    {
      stdio: "inherit",
    },
  );
  child.on("exit", (code) => process.exit(code ?? 0));
}
