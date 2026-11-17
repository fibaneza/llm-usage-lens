// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "./next.config";

// Source: docs/specs/2026-11-10-platform.md — Runtime, "Response security
// headers" (decided 2026-11-11, security review M1): every response carries
// X-Frame-Options, a frame-ancestors CSP, nosniff, Referrer-Policy, HSTS
// without includeSubDomains and Permissions-Policy; X-Powered-By is off.

const PATHS = ["/", "/api/overview", "/dashboard/teams", "/api/health"];

const EXPECTED: Record<string, string> = {
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

// Minimal Next.js `source` matcher for catch-all rules (`/:path*`, `/(.*)`);
// the exact pattern is deliberately not asserted, only that it covers the path.
function sourceMatches(source: string, path: string): boolean {
  const pattern = source
    .replace(/\(\.\*\)/g, ".*")
    .replace(/:\w+\*/g, ".*")
    .replace(/:\w+/g, "[^/]+");
  return new RegExp(`^${pattern}$`).test(path);
}

async function headersFor(path: string): Promise<Map<string, string>> {
  expect(typeof nextConfig.headers).toBe("function");
  const rules = (await nextConfig.headers?.()) ?? [];
  const found = new Map<string, string>();
  for (const rule of rules) {
    if (!sourceMatches(rule.source, path)) continue;
    for (const { key, value } of rule.headers) {
      found.set(key.toLowerCase(), value);
    }
  }
  return found;
}

describe("next.config response security headers", () => {
  it("turns the X-Powered-By header off", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it.each(PATHS)("sets every required header on %s", async (path) => {
    const found = await headersFor(path);
    for (const [key, value] of Object.entries(EXPECTED)) {
      expect(found.get(key), `${key} on ${path}`).toBe(value);
    }
  });

  it("does not pin subdomains in HSTS", async () => {
    const hsts = (await headersFor("/")).get("strict-transport-security");
    expect(hsts).toBeDefined();
    expect(hsts).not.toMatch(/includeSubDomains/i);
    expect(hsts).not.toMatch(/preload/i);
  });

  it("keeps the existing standalone output setting", () => {
    expect(nextConfig.output).toBe("standalone");
  });
});

// 4R.5 review UI-B2: the role-probe Playwright project runs a second dev server
// from this directory with NEXT_DIST_DIR set (playwright.config.ts), so the two
// `next dev` processes do not collide on .next. Unset keeps the default.
describe("next.config distDir override (e2e role-probe server)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("honours NEXT_DIST_DIR and defaults to .next", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_DIST_DIR", ".next-probe-r5");
    const overridden = (await import("./next.config")).default;
    expect(overridden.distDir).toBe(".next-probe-r5");

    vi.resetModules();
    vi.stubEnv("NEXT_DIST_DIR", "");
    const defaulted = (await import("./next.config")).default;
    expect([undefined, ".next"]).toContain(defaulted.distDir);
  });
});

// Unit BP, Platform spec - Base path: BP-D1 (NEXT_PUBLIC_BASE_PATH sets
// Next's basePath; empty serves from /), BP-D2 (an invalid value fails the
// build; the Dockerfile builds with SKIP_ENV_VALIDATION=1 so next.config.ts
// validates through parseBasePath itself). Test T1 of the BP brief.
describe("next.config basePath (BP-D1, BP-D2)", () => {
  async function loadConfig() {
    vi.resetModules();
    return (await import("./next.config")).default;
  }

  it("serves from / when NEXT_PUBLIC_BASE_PATH is empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    expect((await loadConfig()).basePath ?? "").toBe("");
  });

  it("sets basePath from NEXT_PUBLIC_BASE_PATH", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/llm-lens");
    expect((await loadConfig()).basePath).toBe("/llm-lens");
  });

  it("keeps the security headers on the unprefixed source (Next prepends the prefix)", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/llm-lens");
    const rules = (await (await loadConfig()).headers?.()) ?? [];
    expect(rules.some((r) => r.source === "/:path*")).toBe(true);
  });

  it.each(["llm-lens", "/llm-lens/", "/Llm", "//x", "/a b", "https://x/y"])(
    "fails on the invalid value %s",
    async (value) => {
      vi.stubEnv("NEXT_PUBLIC_BASE_PATH", value);
      await expect(loadConfig()).rejects.toThrow();
    },
  );
});
