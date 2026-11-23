// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error -- plain .mjs script with no type declarations (test-only import)
import { buildLocalLine, loadDashboardEnv } from "./dev.mjs";

// Source: docs/guides/auth-setup.md - the root `pnpm dev` runs scripts/dev.mjs,
// which prints `Local: <NEXT_PUBLIC_APP_URL>` and then starts `next dev`;
// docs/specs/2026-11-10-platform.md - Base path (BP-D1, BP-D13: the prefix is
// NEXT_PUBLIC_BASE_PATH, and the deployed NEXT_PUBLIC_APP_URL already carries
// it). Rule 50.2: scripts/** read process.env directly. buildLocalLine is
// pure: no server is started, and importing dev.mjs must not start one.
describe("scripts/dev.mjs buildLocalLine", () => {
  it("prints Local: <NEXT_PUBLIC_APP_URL> when there is no base path", () => {
    expect(
      buildLocalLine({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
    ).toBe("Local: http://localhost:3000");
  });

  it("appends the base path when the URL does not already end with it", () => {
    expect(
      buildLocalLine({
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_BASE_PATH: "/llm-lens",
      }),
    ).toBe("Local: http://localhost:3000/llm-lens");
  });

  it("does not double the base path when the URL already ends with it", () => {
    expect(
      buildLocalLine({
        NEXT_PUBLIC_APP_URL: "https://example.test/llm-lens",
        NEXT_PUBLIC_BASE_PATH: "/llm-lens",
      }),
    ).toBe("Local: https://example.test/llm-lens");
  });

  it("does not double the base path when the URL ends with it and a slash", () => {
    expect(
      buildLocalLine({
        NEXT_PUBLIC_APP_URL: "https://example.test/llm-lens/",
        NEXT_PUBLIC_BASE_PATH: "/llm-lens",
      }),
    ).toBe("Local: https://example.test/llm-lens");
  });

  it("does not double the slash when the URL ends with one", () => {
    expect(
      buildLocalLine({
        NEXT_PUBLIC_APP_URL: "http://localhost:3000/",
        NEXT_PUBLIC_BASE_PATH: "/llm-lens",
      }),
    ).toBe("Local: http://localhost:3000/llm-lens");
  });

  // Platform spec - Base path: the prefix is a whole path segment, so a URL
  // ending in "/llm-lens" does not already carry the base path "/llm".
  it("appends when the URL only ends with the base path as a string suffix", () => {
    expect(
      buildLocalLine({
        NEXT_PUBLIC_APP_URL: "https://x.example/llm-lens",
        NEXT_PUBLIC_BASE_PATH: "/llm",
      }),
    ).toBe("Local: https://x.example/llm-lens/llm");
  });

  it("does not double a base path that is the whole path, with or without a slash", () => {
    for (const url of ["https://x.example/llm", "https://x.example/llm/"]) {
      expect(
        buildLocalLine({
          NEXT_PUBLIC_APP_URL: url,
          NEXT_PUBLIC_BASE_PATH: "/llm",
        }),
      ).toBe("Local: https://x.example/llm");
    }
  });

  it("treats an empty base path as none", () => {
    expect(
      buildLocalLine({
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_BASE_PATH: "",
      }),
    ).toBe("Local: http://localhost:3000");
  });
});

// The variables live in apps/dashboard/.env* (Next loads them from the app
// directory, not the repo root), so the script loads them with @next/env
// before it builds the line. A temp-dir fixture stands in for the repo root.
describe("scripts/dev.mjs loadDashboardEnv", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("reads NEXT_PUBLIC_APP_URL and NEXT_PUBLIC_BASE_PATH from apps/dashboard/.env", () => {
    const root = mkdtempSync(join(tmpdir(), "dev-env-"));
    dirs.push(root);
    mkdirSync(join(root, "apps", "dashboard"), { recursive: true });
    writeFileSync(
      join(root, "apps", "dashboard", ".env"),
      "NEXT_PUBLIC_APP_URL=http://localhost:3999/llm-lens\nNEXT_PUBLIC_BASE_PATH=/llm-lens\n",
    );
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", undefined);

    const env = loadDashboardEnv(root);

    expect(buildLocalLine(env)).toBe("Local: http://localhost:3999/llm-lens");
  });

  it("does not read a .env at the repo root", () => {
    const root = mkdtempSync(join(tmpdir(), "dev-env-"));
    dirs.push(root);
    mkdirSync(join(root, "apps", "dashboard"), { recursive: true });
    writeFileSync(join(root, ".env"), "NEXT_PUBLIC_APP_URL=http://root.test\n");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);

    const env = loadDashboardEnv(root);

    expect(env.NEXT_PUBLIC_APP_URL).toBeUndefined();
  });
});
