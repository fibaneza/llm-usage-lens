// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source: docs/specs/2026-11-10-platform.md - Base path: BP-D3 (code keeps
// unprefixed literals; Next prefixes Link, router and redirect(); one helper,
// withBasePath, covers what Next does not: the fetch chokepoint
// lib/query/fetch-api.ts and raw anchors) and BP-D13 (the four sites). Test T5
// of the BP brief: a raw fetch of "/api..." or a raw <a href="/..."> would
// escape the prefix, so none may exist outside the allowed site. Reads files,
// like the other structure suites.
const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".next", "e2e", "test", "coverage"]);
const FETCH_CHOKEPOINT = "lib/query/fetch-api.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".next")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const sources = ["app", "components", "hooks", "lib"].flatMap((dir) =>
  walk(join(APP, dir)).map((file) => ({
    file: relative(APP, file).split(sep).join("/"),
    text: readFileSync(file, "utf8"),
  })),
);

function offenders(pattern: RegExp, allowed: (file: string) => boolean) {
  return sources
    .filter((s) => !allowed(s.file))
    .flatMap((s) =>
      [...s.text.matchAll(pattern)].map(
        (m) => `${s.file}: ${m[0].replace(/\s+/g, " ").slice(0, 80)}`,
      ),
    );
}

describe("base path structure (BP-D3, T5)", () => {
  it("scans a non-trivial set of source files", () => {
    expect(sources.length).toBeGreaterThan(200);
    expect(sources.some((s) => s.file === FETCH_CHOKEPOINT)).toBe(true);
  });

  it('has no raw fetch("/api...") outside lib/query/fetch-api.ts', () => {
    expect(
      offenders(/\bfetch\(\s*["'`]\/api/g, (f) => f === FETCH_CHOKEPOINT),
    ).toEqual([]);
  });

  it('has no raw <a href="/..."> in app/ and components/ (use Link, or withBasePath)', () => {
    expect(
      offenders(
        /<a\b[^>]*?\bhref=(?:"\/(?!\/)|\{\s*["'`]\/(?!\/))/g,
        (f) => !/^(app|components)\//.test(f),
      ),
    ).toEqual([]);
  });

  it("routes the fetch chokepoint through withBasePath", () => {
    const chokepoint = sources.find((s) => s.file === FETCH_CHOKEPOINT);
    expect(chokepoint?.text).toMatch(/withBasePath/);
  });
});
