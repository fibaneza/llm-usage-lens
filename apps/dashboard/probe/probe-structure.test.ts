import { existsSync, readFileSync, readdirSync, globSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import playwrightConfig from "../playwright.config";

// Source: docs/specs/2026-11-10-litellm.md - "Polish and verification (L5)",
// End-to-end probe: "never part of `pnpm test:e2e`, `pnpm check` or CI", "its
// own command (`pnpm probe:litellm`, a separate Playwright config)"; LD28.
// The walk (probe/litellm-probe.spec.ts) must be reachable only from the probe
// config; the guard's own unit test (probe/probe-guard.test.ts) is the one file
// here Vitest runs. Lint and typecheck cover probe/ like any dashboard code.
const PROBE_DIR = dirname(fileURLToPath(import.meta.url));
const DASHBOARD = resolve(PROBE_DIR, "..");
const ROOT = resolve(DASHBOARD, "../..");
const rel = (p: string) => relative(ROOT, p);

const probeFiles = () =>
  readdirSync(PROBE_DIR)
    .filter((f) => !f.startsWith("."))
    .map((f) => join(PROBE_DIR, f));

describe("the probe directory layout (LD28)", () => {
  it("holds the config, the walk spec, the guard and its tests", () => {
    for (const name of [
      "playwright.probe.config.ts",
      "litellm-probe.spec.ts",
      "probe-guard.ts",
      "probe-guard.test.ts",
    ]) {
      expect(existsSync(join(PROBE_DIR, name)), name).toBe(true);
    }
  });

  it("names the walk .spec.ts, the Playwright suffix, never Vitest's", () => {
    expect(existsSync(join(PROBE_DIR, "litellm-probe.spec.ts"))).toBe(true);
    expect(existsSync(join(PROBE_DIR, "litellm-probe.test.ts"))).toBe(false);
  });
});

describe("Vitest never runs the walk spec", () => {
  // vitest.config.ts is read as text: importing it needs a file: URL, which the
  // jsdom unit project does not provide. Every `include` list of test globs.
  const includes = (): string[] => {
    const text = readFileSync(join(ROOT, "vitest.config.ts"), "utf8");
    const lists = [...text.matchAll(/include:\s*\[([^\]]*)\]/g)].map((m) =>
      [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map((q) => q[1] ?? ""),
    );
    return lists.flat().filter((p) => /\.test\./.test(p));
  };

  it("finds the project include globs", () => {
    expect(includes().length).toBeGreaterThanOrEqual(5);
  });

  it("no project includes a *.spec.* file", () => {
    for (const pattern of includes()) {
      expect(pattern).not.toMatch(/\.spec\b/);
    }
  });

  it("the only probe files a Vitest project matches are the *.test.ts guard and structure tests, never the walk", () => {
    const matched = new Set<string>();
    for (const pattern of includes()) {
      for (const file of globSync(pattern, { cwd: ROOT })) {
        if (file.startsWith("apps/dashboard/probe/")) matched.add(file);
      }
    }
    expect([...matched].sort()).toEqual([
      "apps/dashboard/probe/probe-guard.test.ts",
      "apps/dashboard/probe/probe-structure.test.ts",
    ]);
  });
});

describe("the main Playwright config (pnpm test:e2e) never runs the walk spec", () => {
  const config = playwrightConfig as unknown as {
    testDir?: string;
    testMatch?: unknown;
    projects?: Array<{ testDir?: string; testMatch?: unknown }>;
  };

  it("testDir is e2e/ and the probe directory is not under it", () => {
    expect(config.testDir).toBeDefined();
    const testDir = resolve(DASHBOARD, config.testDir as string);
    expect(testDir).toBe(join(DASHBOARD, "e2e"));
    expect(PROBE_DIR.startsWith(`${testDir}/`)).toBe(false);
    expect(rel(testDir)).not.toContain("probe");
  });

  it("no project redirects testDir or testMatch at probe/", () => {
    for (const p of config.projects ?? []) {
      if (p.testDir) {
        expect(resolve(DASHBOARD, p.testDir)).toBe(join(DASHBOARD, "e2e"));
      }
      expect(String(p.testMatch ?? "")).not.toContain("probe");
    }
  });

  it("e2e/ holds no copy of the walk spec", () => {
    expect(existsSync(join(DASHBOARD, "e2e", "litellm-probe.spec.ts"))).toBe(
      false,
    );
  });
});

describe("the probe's own command (LD28)", () => {
  const config = () =>
    readFileSync(join(PROBE_DIR, "playwright.probe.config.ts"), "utf8");
  const scripts = (
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;

  it("the probe config runs the guard before anything else and only the walk spec", () => {
    const text = config();
    expect(text).toContain("assertProbeAllowed");
    expect(text).toContain("./probe-guard");
    expect(text).toMatch(/litellm-probe\.spec\.ts/);
  });

  it("pnpm probe:litellm and probe:litellm:fake exist and use the probe config", () => {
    expect(scripts["probe:litellm"]).toContain("playwright.probe.config.ts");
    expect(scripts["probe:litellm:fake"]).toContain(
      "playwright.probe.config.ts",
    );
    expect(scripts["probe:litellm:fake"]).toContain("LITELLM_PROBE_MODE=fake");
  });

  it("the real command does not select fake mode, and neither script sets a base URL or key", () => {
    expect(scripts["probe:litellm"]).not.toContain("LITELLM_PROBE_MODE");
    for (const name of ["probe:litellm", "probe:litellm:fake"]) {
      expect(scripts[name]).not.toMatch(/SERVICE_KEY|sk-/);
    }
  });

  it("test:e2e, test, check and the CI test commands never reference the probe", () => {
    for (const name of [
      "test",
      "test:e2e",
      "test:unit",
      "test:integration",
      "check",
    ]) {
      const script = scripts[name];
      if (script === undefined) continue;
      expect(script, name).not.toMatch(/probe/);
    }
  });
});

describe("typecheck and lint cover probe/ (Rule 60)", () => {
  it("tsconfig.json includes every probe file", () => {
    const configPath = join(DASHBOARD, "tsconfig.json");
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      DASHBOARD,
    );
    const files = new Set(parsed.fileNames.map((f) => resolve(f)));
    for (const file of probeFiles().filter((f) => f.endsWith(".ts"))) {
      expect(files.has(file), rel(file)).toBe(true);
    }
  });

  it("ESLint does not ignore any probe file", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    for (const file of probeFiles().filter((f) => f.endsWith(".ts"))) {
      expect(await eslint.isPathIgnored(file), rel(file)).toBe(false);
    }
  }, 60_000);
});
