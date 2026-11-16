import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source: docs/specs/2026-11-10-access-control.md — "Storage boundary (D26.1,
// D26.3 amended R2a)", Rule 10.5, threat T29 (structural part); contract
// addendum B.7. The AWS SDK allow-list is Rule 10.5's (app/api, lib/data,
// lib/dynamodb.ts, collector, scripts) plus infra (CDK) and test helpers.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SKIP = new Set(["node_modules", ".next", "cdk.out", "dist", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = ["apps", "packages", "scripts", "infra"]
  .map((d) => join(ROOT, d))
  .filter((d) => existsSync(d))
  .flatMap((d) => walk(d))
  .map((f) => relative(ROOT, f).split(sep).join("/"));

const importsOf = (file: string): string[] => {
  const src = readFileSync(join(ROOT, file), "utf8");
  return [...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (m) => m[1] ?? "",
  );
};

const AWS_ALLOWED = [
  /^apps\/dashboard\/lib\/data\//,
  /^apps\/dashboard\/lib\/dynamodb(\.[a-z]+)*\.ts$/,
  /^apps\/dashboard\/app\/api\//,
  /^apps\/dashboard\/test\//,
  /^apps\/collector\//,
  /^scripts\//,
  /^infra\//,
];

describe("access-control storage boundary", () => {
  it("scans a non-trivial set of source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no file outside the allowed server/tooling locations imports @aws-sdk/*", () => {
    const offenders = files.filter(
      (f) =>
        !/\.test\.tsx?$/.test(f) &&
        !AWS_ALLOWED.some((re) => re.test(f)) &&
        importsOf(f).some((s) => s.startsWith("@aws-sdk/")),
    );
    expect(offenders).toEqual([]);
  });

  it("keys.ts exists, is pure and carries no server-only import", () => {
    const path = "apps/dashboard/lib/data/access/keys.ts";
    expect(files).toContain(path);
    expect(importsOf(path)).not.toContain("server-only");
    expect(importsOf(path).filter((s) => s.startsWith("@aws-sdk/"))).toEqual(
      [],
    );
  });

  it("only lib/data/access/** and scripts/** import access/keys", () => {
    const offenders = files.filter((f) => {
      if (
        f.startsWith("apps/dashboard/lib/data/access/") ||
        f === "apps/dashboard/test/support/access-test-support.ts" ||
        f === "apps/dashboard/test/support/keys-test-support.ts" ||
        f.startsWith("scripts/")
      ) {
        return false;
      }
      return importsOf(f).some((s) => /(^|\/)access\/keys$/.test(s));
    });
    expect(offenders).toEqual([]);
  });

  // Coordinator ruling, 2026-11-16, 4R.5: Playwright cannot load keys.ts
  // through the server-only graph, so e2e seeds use a pure re-export (exempt
  // like keys.ts: no I/O). Spec: Access Control - Storage boundary (D26.1).
  it("keys-test-support.ts imports nothing except the access keys module (coordinator 2026-11-16, 4R.5)", () => {
    const path = "apps/dashboard/test/support/keys-test-support.ts";
    expect(files).toContain(path);
    expect(importsOf(path)).toEqual(["../../lib/data/access/keys"]);
  });

  it('keys-test-support.ts body is only `export { ... } from "../../lib/data/access/keys"` statements (coordinator 2026-11-16, 4R.5; review W1)', () => {
    const source = readFileSync(
      join(ROOT, "apps/dashboard/test/support/keys-test-support.ts"),
      "utf8",
    );
    const body = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    expect(body).toMatch(
      /^(export \{[^{}]*\} from "\.\.\/\.\.\/lib\/data\/access\/keys";? ?)+$/,
    );
  });

  it("keys-test-support is imported only from test files, test/** and e2e/** (coordinator 2026-11-16, 4R.5)", () => {
    const offenders = files.filter(
      (f) =>
        !/\.test\.tsx?$/.test(f) &&
        !/^apps\/dashboard\/(test|e2e)\//.test(f) &&
        !f.endsWith("/keys-test-support.ts") &&
        importsOf(f).some((s) => /(^|\/)keys-test-support$/.test(s)),
    );
    expect(offenders).toEqual([]);
  });

  it("every storage module (all but the pure keys, result and cursor modules) is server-only", () => {
    const modules = files.filter(
      (f) =>
        /^apps\/dashboard\/lib\/data\/access\/[^/]+\.ts$/.test(f) &&
        !/\.test\.ts$/.test(f) &&
        !f.endsWith("/keys.ts") &&
        !f.endsWith("/keys-test-support.ts") &&
        !f.endsWith("/access-test-support.ts") &&
        !f.endsWith("/result.ts") &&
        !f.endsWith("/cursor.ts"),
    );
    expect(modules.length).toBeGreaterThanOrEqual(6);
    const missing = modules.filter(
      (f) => !importsOf(f).includes("server-only"),
    );
    expect(missing).toEqual([]);
  });
});
