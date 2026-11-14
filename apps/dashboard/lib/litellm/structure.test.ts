import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" items 1,
// 3, 5 and threats LT1 (server-only; key never in the bundle), LT2 (no master
// key variable, parameter or reference); Rule 10.2 (lib/litellm/** is
// server-only; no Client Component imports it); prompts/litellm_prompt.md §3
// (no SSM client import under apps/).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SKIP = new Set([
  "node_modules",
  ".next",
  "cdk.out",
  "dist",
  ".git",
  "temp",
  "worktrees",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const read = (f: string) => readFileSync(f, "utf8");
const isCode = (f: string) => /\.(ts|tsx)$/.test(f);
const isTest = (f: string) =>
  /\.(test|spec)\.(ts|tsx)$/.test(f) || /\/test\//.test(f);

const litellmDir = join(ROOT, "apps/dashboard/lib/litellm");
const litellmFiles = existsSync(litellmDir)
  ? walk(litellmDir).filter((f) => isCode(f) && !isTest(rel(f)))
  : [];

describe("lib/litellm is server-only", () => {
  it("contains production modules (client.ts at least)", () => {
    expect(litellmFiles.map(rel)).toContain(
      "apps/dashboard/lib/litellm/client.ts",
    );
  });

  it('every production file starts with import "server-only"', () => {
    const offenders = litellmFiles.filter(
      (f) => !/^\s*import\s+["']server-only["'];?/.test(read(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('no "use client" module imports lib/litellm, lib/data/litellm or env.ts secrets', () => {
    const files = walk(join(ROOT, "apps/dashboard")).filter(
      (f) => isCode(f) && !isTest(rel(f)),
    );
    const offenders = files.filter((f) => {
      const src = read(f);
      return (
        /^\s*["']use client["']/m.test(
          src.split("\n").slice(0, 3).join("\n"),
        ) &&
        /["']@\/lib\/(litellm|data\/litellm)\b|\.\.?\/.*\blitellm\//.test(src)
      );
    });
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("no master key anywhere (LT2)", () => {
  const roots = ["apps", "infra", ".github", "packages", "scripts"]
    .map((d) => join(ROOT, d))
    .filter(existsSync);
  const files = roots
    .flatMap((r) => walk(r))
    .filter(
      (f) =>
        /\.(ts|tsx|json|ya?ml|sh|cjs|mjs|example|md)$/.test(f) ||
        f.endsWith(".env.example"),
    )
    .filter((f) => !isTest(rel(f)) && !rel(f).includes("pnpm-lock"));

  it("scans a non-trivial set of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no master-key variable, parameter or CDK reference in apps/, infra/, packages/, scripts/ or workflows", () => {
    const offenders = files.filter((f) =>
      /LITELLM_MASTER|litellm[-_/ ]?master|master[-_ ]key[-_ ]?param/i.test(
        read(f),
      ),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no SSM or KMS client import under apps/ (the key is injected by ECS, never fetched)", () => {
    const offenders = walk(join(ROOT, "apps"))
      .filter((f) => isCode(f))
      .filter((f) => rel(f) !== "apps/dashboard/lib/data/secret-envelope.ts")
      .filter((f) => /@aws-sdk\/client-(ssm|kms)\b/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no code path writes the SSM parameter (no PutParameter anywhere in apps/, infra/lib, scripts/)", () => {
    const offenders = [
      ...walk(join(ROOT, "apps")),
      ...walk(join(ROOT, "infra/lib")),
      ...walk(join(ROOT, "scripts")),
    ]
      .filter((f) => isCode(f) && !isTest(rel(f)))
      .filter((f) => /PutParameter/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("the service key is read only inside lib/litellm and env.ts (LT1, Rule 50.6)", () => {
  it("no other production file references LITELLM_SERVICE_KEY", () => {
    const files = walk(join(ROOT, "apps/dashboard")).filter(
      (f) => isCode(f) && !isTest(rel(f)),
    );
    const allowed = (p: string) =>
      p === "apps/dashboard/env.ts" ||
      p.startsWith("apps/dashboard/lib/litellm/") ||
      p.startsWith("apps/dashboard/app/api/litellm/");
    const offenders = files
      .map(rel)
      .filter((p) => !allowed(p))
      .filter((p) => read(join(ROOT, p)).includes("LITELLM_SERVICE_KEY"));
    expect(offenders).toEqual([]);
  });

  it("no source under app/ or components/ interpolates the key into a string sent to the browser", () => {
    const files = walk(join(ROOT, "apps/dashboard")).filter(
      (f) => isCode(f) && !isTest(rel(f)),
    );
    const offenders = files.filter((f) => /NEXT_PUBLIC_LITELLM/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});
