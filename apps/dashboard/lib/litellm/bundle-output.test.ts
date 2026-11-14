// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source: docs/specs/2026-11-10-litellm.md — threat LT1 / "Security
// architecture" item 3 (the service key is server-only) and the L1 Verify
// "bundle and static-output grep". Scans the browser-reachable build output
// (`.next/static/**`) produced by `pnpm build:ci`.
//
// The test needs a build. With no `.next/static` it SKIPS (never passes
// vacuously) unless REQUIRE_BUILD_OUTPUT=1, in which case it FAILS. Run it
// after the build:  pnpm build:ci && REQUIRE_BUILD_OUTPUT=1 pnpm exec vitest
// run apps/dashboard/lib/litellm/bundle-output.test.ts
const STATIC_DIR = fileURLToPath(
  new URL("../../.next/static", import.meta.url),
);
const required = process.env.REQUIRE_BUILD_OUTPUT === "1";
const built = existsSync(STATIC_DIR);

// LT1 concerns the key VALUE. The variable NAME may ship in the shared env
// schema chunk (no values), so names are deliberately not asserted. build:ci
// sets LITELLM_SERVICE_KEY=sk-ci-build-sentinel (non-secret) so this scan is
// not vacuous; the other sentinel is its placeholder secret value.
const FORBIDDEN_VALUES = ["ci-build-placeholder", "sk-ci-build-sentinel"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

if (required && !built) {
  describe("build output (LT1)", () => {
    it("exists when REQUIRE_BUILD_OUTPUT=1 (run pnpm build:ci first)", () => {
      expect(built).toBe(true);
    });
  });
}

describe.skipIf(!built)(
  "build output .next/static (LT1) — skipped: no build output, run pnpm build:ci",
  () => {
    const texts = built
      ? files(STATIC_DIR)
          .filter((f) => /\.(js|css|html|json|txt|map)$/.test(f))
          .map((f) => ({ f, text: readFileSync(f, "utf8") }))
      : [];

    it("scans at least one file", () => {
      expect(texts.length).toBeGreaterThan(0);
    });

    it.each(FORBIDDEN_VALUES)("contains no secret value %s", (value) => {
      expect(
        texts.filter((t) => t.text.includes(value)).map((t) => t.f),
      ).toEqual([]);
    });
  },
);
