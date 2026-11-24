import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TOKEN_A,
  UNLINKED_LTEAM,
  call,
  enterProd,
  expectError,
  expectNoSentinels,
  installFake,
  setToggles,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
  useEnv,
} from "@/test/fakes/fake-litellm-views";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { grantRole } from "@/lib/data/access/role-grants";
import { signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";

// Source: docs/specs/2026-11-10-litellm.md — "Audit" item 3 (LiteLLM audit
// view, LD15: only updated_at, changed_by, action, table_name, object_id and
// the NAMES of changed fields are shown; before_value / updated_values
// contents and changed_by_api_key dropped; 'via dashboard' label for
// llm-usage-lens: actors; viewing is audited as litellm.audit.view), "Reads"
// (listProxyAuditLog: dates <= 90 days, page, page_size <= 100, optional
// action, table_name, object_id), "API routes" (/api/litellm/audit GET Admin,
// Auditor), threat LT20, Access Control "Audit log", Rules 10.3, 60.23.
//
// Contract for the developer (.../audit/route.ts, GET):
//   query: dateFrom, dateTo (<= 90 days), page, pageSize (<= 100), action, tableName, objectId.
//   200 data = { items: [{ id, updatedAt, changedBy, action, tableName, objectId,
//                          changedFields: string[], viaDashboard: boolean }], page, totalPages, total }.
//   Admin and Auditor only; any other signed-in caller: 403 FORBIDDEN.
//   Each successful view appends one audit record, action "litellm.audit.view"
//   (add to AUDIT_ACTIONS in packages/shared), actor = session oid, result "success".
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const DATES = "dateFrom=2026-11-01&dateTo=2026-11-14";
const state = setupViewsSuite();
const get = async (query = `?${DATES}`) => {
  stubLiteLLMEnv();
  const { GET } = await import("./route");
  return call(GET, `/api/litellm/audit${query}`);
};
async function viewRecords() {
  const { listAuditRecords } = await import("@/lib/data/access/audit");
  return (await listAuditRecords("2026-11-14")).filter(
    (r) => String(r.action) === "litellm.audit.view",
  );
}

// The audit log is an Enterprise endpoint (LiteLLM spec - Audit, D-LF2), so
// the behaviour below runs on Enterprise (APP_ENV=prod); OSS is the next block.
describe("GET /api/litellm/audit", () => {
  beforeEach(async () => {
    await enterProd();
  });

  it.each([
    ["admin", true],
    ["auditor", true],
    ["orgAdmin", false],
    ["teamAdminA", false],
    ["deptAdminEng", false],
    ["memberA", false],
    ["viewerNone", false],
  ] as Array<[CallerName, boolean]>)(
    "%s -> allowed: %s (API routes: Admin, Auditor)",
    async (who, allowed) => {
      signInAs(who);
      const { res } = await get();
      if (allowed) expect(res.status).toBe(200);
      else {
        await expectError(res, 403, "FORBIDDEN");
        expect(state.fake.calls).toHaveLength(0);
        expect(await viewRecords()).toHaveLength(0);
      }
    },
  );

  it("a session with no role is 403 FORBIDDEN", async () => {
    await signInWithRoles([]);
    const { res } = await get();
    await expectError(res, 403, "FORBIDDEN");
  });

  it("returns only the allowlisted fields and the NAMES of changed fields (Audit item 3)", async () => {
    signInAs("auditor");
    const { body } = await get();
    expect(body.data.items[0]).toEqual({
      id: "audit-1",
      updatedAt: "2026-11-14T10:00:00Z",
      changedBy: "llm-usage-lens:jane@company.com",
      action: "updated",
      tableName: "LiteLLM_TeamTable",
      objectId: UNLINKED_LTEAM,
      changedFields: ["max_budget"],
      viaDashboard: true,
    });
    expect(body.data.items[1]).toMatchObject({
      objectId: TOKEN_A,
      changedBy: "ops@litellm.test",
      changedFields: ["models"],
      viaDashboard: false,
    });
  });

  it("before/after contents and changed_by_api_key never reach the response (LT20)", async () => {
    signInAs("admin");
    const { body, text } = await get();
    expectNoSentinels(body);
    expect(text).not.toContain("before_value");
    expect(text).not.toContain("updated_values");
    expect(text).not.toContain("changed_by_api_key");
  });

  it("forwards the built query to /audit (Reads: listProxyAuditLog)", async () => {
    signInAs("admin");
    await get(
      `?${DATES}&page=2&pageSize=50&action=updated&tableName=LiteLLM_TeamTable&objectId=${UNLINKED_LTEAM}`,
    );
    const audit = state.fake.calls.find((c) => c.path === "/audit")!;
    const q = new URL(audit.url).searchParams;
    expect(Object.fromEntries(q.entries())).toMatchObject({
      start_date: "2026-11-01",
      end_date: "2026-11-14",
      page: "2",
      page_size: "50",
      action: "updated",
      table_name: "LiteLLM_TeamTable",
      object_id: UNLINKED_LTEAM,
    });
  });

  it.each([
    ["a range over 90 days", "?dateFrom=2026-01-01&dateTo=2026-06-01"],
    ["pageSize 101", `?${DATES}&pageSize=101`],
    ["an unknown tableName", `?${DATES}&tableName=LiteLLM_Anything`],
    ["no dates", ""],
  ])(
    "400 BAD_REQUEST for %s with no LiteLLM call and no view record (Reads bounds)",
    async (_n, query) => {
      signInAs("admin");
      const { res } = await get(query);
      await expectError(res, 400, "BAD_REQUEST");
      expect(state.fake.calls).toHaveLength(0);
      expect(await viewRecords()).toHaveLength(0);
    },
  );

  it("a successful view appends exactly one litellm.audit.view record for the viewer (audited view; LD15)", async () => {
    signInAs("auditor");
    await get();
    const records = await viewRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "litellm.audit.view",
      result: "success",
    });
    expect(JSON.stringify(records[0])).not.toContain("AUDIT-VALUE-SENTINEL");
  });

  it("a disabled listProxyAuditLog is 403 OPERATION_DISABLED, no call and no record (LD19)", async () => {
    await setToggles({ listProxyAuditLog: false });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
    expect(await viewRecords()).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE and records no successful view (error codes)", async () => {
    installFake(state, { outage: true });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(await viewRecords()).toHaveLength(0);
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

  // Rule 50.4; GrantableRole is internal-admin | internal-org-admin only, so
  // the Admin grant is the grant that reaches the guard.
  it("a stored internal-admin grant opens the route for a session whose claim lacks the role (Rule 50.4)", async () => {
    await signInWithRoles([]);
    ok(
      await grantRole(
        {
          oid: "00000000-0000-4000-8000-0000000009ff",
          role: "internal-admin",
          reason: "test",
        },
        ctxAt(),
      ),
    );
    const { res } = await get();
    expect(res.status).toBe(200);
  });
});

// Source: docs/specs/2026-11-10-litellm.md - Audit, D-LF2 (edition state),
// "Edition" (OPERATION_UNAVAILABLE), Design System - Management pages (Audit
// page, Gateway source). OSS = APP_ENV=dev.
describe("GET /api/litellm/audit on LiteLLM OSS (D-LF2)", () => {
  it.each(["admin", "auditor"] as CallerName[])(
    "%s -> 403 OPERATION_UNAVAILABLE, no LiteLLM call, no view record",
    async (who) => {
      installFake(state, { edition: "oss" });
      signInAs(who);
      const { res } = await get();
      await expectError(res, 403, "OPERATION_UNAVAILABLE");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(state.fake.calls).toHaveLength(0);
      expect(await viewRecords()).toHaveLength(0);
    },
  );

  it("the edition is checked before the toggle: a disabled listProxyAuditLog on OSS is OPERATION_UNAVAILABLE, not OPERATION_DISABLED", async () => {
    installFake(state, { edition: "oss" });
    await setToggles({ listProxyAuditLog: false });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each(["orgAdmin", "teamAdminA", "memberA"] as CallerName[])(
    "%s has no gateway source: 403 FORBIDDEN, never the Enterprise state",
    async (who) => {
      installFake(state, { edition: "oss" });
      signInAs(who);
      const { res } = await get();
      await expectError(res, 403, "FORBIDDEN");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("on Enterprise a real outage stays 503 LITELLM_UNAVAILABLE", async () => {
    await enterProd();
    installFake(state, { edition: "enterprise", outage: true });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
  });
});

// Source: docs/specs/2026-11-10-litellm.md - Allowlist `listProxyAuditLog`
// ("from 2026-11-24 (unit SRT1, coordinator ruling): `sort_by=updated_at`
// fixed by the server and `sort_order` (`asc`, `desc`) from the route's
// `dir`") and API routes `/api/litellm/audit` ("SRT1 (2026-11-24): `dir`
// (`asc`, `desc`; default `desc`, newest first) sorts by time through
// `listProxyAuditLog`'s `sort_order`; any other value `400`"); LD15.
describe("GET /api/litellm/audit dir (unit SRT1, D-SR1)", () => {
  beforeEach(async () => {
    await enterProd();
    signInAs("admin");
  });
  const auditQuery = () => {
    const call = state.fake.calls.find((c) => c.path === "/audit")!;
    return new URL(call.url).searchParams;
  };

  it.each([
    ["no dir (default desc, newest first)", "", "desc"],
    ["dir=desc", "&dir=desc", "desc"],
    ["dir=asc", "&dir=asc", "asc"],
  ])(
    "%s sends sort_by=updated_at and the sort_order of the direction",
    async (_n, extra, order) => {
      const { res } = await get(`?${DATES}${extra}`);
      expect(res.status).toBe(200);
      const q = auditQuery();
      expect(q.get("sort_by")).toBe("updated_at");
      expect(q.get("sort_order")).toBe(order);
    },
  );

  it.each(["ASC", "up", "newest", "created_at"])(
    "dir=%s is 400 BAD_REQUEST: no LiteLLM call, no view record",
    async (dir) => {
      const { res } = await get(`?${DATES}&dir=${dir}`);
      await expectError(res, 400, "BAD_REQUEST");
      expect(state.fake.calls).toHaveLength(0);
      expect(await viewRecords()).toHaveLength(0);
    },
  );

  it("a client sort_by or sort_order is never passed on: the key is the server's (never a client string to LiteLLM)", async () => {
    await get(`?${DATES}&sort_by=action&sort_order=asc&dir=desc`);
    const q = auditQuery();
    expect(q.get("sort_by")).toBe("updated_at");
    expect(q.get("sort_order")).toBe("desc");
  });
});
