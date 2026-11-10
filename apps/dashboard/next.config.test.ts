// @vitest-environment node
import { describe, expect, it } from "vitest";

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
