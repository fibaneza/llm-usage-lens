import { describe, expect, it, vi } from "vitest";

import {
  call,
  expectError,
  installFake,
  setToggles,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
  useEnv,
} from "@/test/fake-litellm-views";
import { ctxAt, ok } from "@/lib/data/access/access-test-support";
import { grantRole } from "@/lib/data/access/role-grants";
import { signInAs } from "@/test/scope-fixtures";
import type { CallerName } from "@/test/scope-fixtures";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/models
// GET: Lead, Admin), "Reads" (listProxyModels: GET /models with
// return_wildcard_routes=false; Who: Lead, Admin), "Roles and rights"
// (Auditor/Viewer have no model-list view), implementation-phases L3,
// Rules 10.3, 60.23.
//
// Contract for the developer (.../models/route.ts, GET):
//   200 data = { items: string[] } (model names, in LiteLLM's order).
//   Lead = any admin scope (team or department) or internal-org-admin; Admin = internal-admin.
//   Everyone else signed in: 403 FORBIDDEN (not 404: the route has no per-team id to hide).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupViewsSuite();
const get = async () => {
  stubLiteLLMEnv();
  const { GET } = await import("./route");
  return call(GET, "/api/litellm/models");
};

describe("GET /api/litellm/models", () => {
  it.each([
    ["teamAdminA", true],
    ["deptAdminEng", true],
    ["orgAdmin", true],
    ["admin", true],
    ["auditor", false],
    ["memberA", false],
    ["viewerNone", false],
  ] as Array<[CallerName, boolean]>)(
    "%s -> allowed: %s (Reads: listProxyModels Lead, Admin)",
    async (who, allowed) => {
      signInAs(who);
      const { res, body } = await get();
      if (allowed) {
        expect(res.status).toBe(200);
        expect(body.data.items).toEqual(["claude-sonnet", "claude-haiku"]);
      } else {
        await expectError(res, 403, "FORBIDDEN");
        expect(state.fake.calls).toHaveLength(0);
      }
    },
  );

  it("a session with no role is 403 FORBIDDEN", async () => {
    await signInWithRoles([]);
    const { res } = await get();
    await expectError(res, 403, "FORBIDDEN");
  });

  it("asks LiteLLM for names only, wildcard routes excluded (Reads built query; LD7)", async () => {
    signInAs("admin");
    await get();
    const models = state.fake.calls.find((c) => c.path === "/models")!;
    expect(new URL(models.url).searchParams.get("return_wildcard_routes")).toBe(
      "false",
    );
    expect(state.fake.calls.every((c) => c.path === "/models")).toBe(true);
  });

  it("a disabled listProxyModels is 403 OPERATION_DISABLED before any call (LD19)", async () => {
    await setToggles({ listProxyModels: false });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE (error codes)", async () => {
    installFake(state, { outage: true });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE (LT11)", async () => {
    useEnv({ AUTH_ACCESS_MODE: "open" });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
  });

  it("a 200 carries Cache-Control private, no-store (API routes)", async () => {
    signInAs("admin");
    const { res } = await get();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  // Rule 50.4; Access Control - Roles: global roles include stored RoleGrants.
  it("a stored internal-org-admin grant opens the route for a session whose claim lacks the role (Rule 50.4)", async () => {
    await signInWithRoles([]);
    ok(
      await grantRole(
        {
          oid: "00000000-0000-4000-8000-0000000009ff",
          role: "internal-org-admin",
          reason: "test",
        },
        ctxAt(),
      ),
    );
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(body.data.items).toEqual(["claude-sonnet", "claude-haiku"]);
  });

  it("a grant held by another identity does not open the route (Rule 50.4)", async () => {
    await signInWithRoles([]);
    ok(
      await grantRole(
        {
          oid: "00000000-0000-4000-8000-0000000009aa",
          role: "internal-org-admin",
          reason: "test",
        },
        ctxAt(),
      ),
    );
    const { res } = await get();
    await expectError(res, 403, "FORBIDDEN");
  });
});
