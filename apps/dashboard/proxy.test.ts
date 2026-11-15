// @vitest-environment node
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { config } from "@/proxy";

// Source: docs/specs/2026-11-10-access-control.md — "API routes" (GET
// /api/health is the one route served without a session; the ALB health check
// cannot sign in); docs/specs/2026-11-10-platform.md — "Health check";
// Rule 10.3, 50.4. The proxy must not redirect /api/health to sign-in, and
// must keep protecting everything else (including look-alike paths).
const matches = (path: string) =>
  unstable_doesMiddlewareMatch({ config, url: `http://localhost${path}` });

describe("proxy matcher", () => {
  it("does not match /api/health (unauthenticated health check)", () => {
    expect(matches("/api/health")).toBe(false);
  });

  it.each([
    "/api/healthz",
    "/api/health-x",
    "/api/health/x",
    "/api/overview",
    "/api/accounts/x",
    "/dashboard/x",
    // Only /api/auth and /api/auth/* are Auth.js's; look-alikes stay
    // protected (4R.4 follow-up from fix/api-unauthenticated-401).
    "/api/authorization",
    "/api/authx",
    "/api/auth-tokens",
  ])("still protects %s", (path) => {
    expect(matches(path)).toBe(true);
  });

  it.each(["/api/auth", "/api/auth/signin", "/api/auth/callback/x"])(
    "does not match the Auth.js route %s",
    (path) => {
      expect(matches(path)).toBe(false);
    },
  );
});
