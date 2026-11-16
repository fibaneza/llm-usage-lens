import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import {
  CURSOR_SECRET,
  ctxAt,
  faults,
  ok,
  resetFaults,
} from "@/lib/data/access/access-test-support";
import { resetDeniedAudit } from "@/lib/data/access/audit";
import { grantRole, listRoleGrants } from "@/lib/data/access/role-grants";
import {
  SESSIONS,
  auditToday,
  deniedToday,
  expectData,
  expectError,
  invoke,
  nonAuditItems,
  type Caller,
} from "@/test/governance-route-support";
import { clearTable, ensureTestTable } from "@/test/test-support";

import { GET, POST } from "./role-grants/route";

// Source: docs/specs/2026-11-10-access-control.md - "Roles" (in-app grants:
// internal-admin only, reason required, audited role.grant / role.revoke as
// security events, the last internal-admin cannot be revoked: 409),
// "Recent authentication" (D28: a sign-in within 900 s else 403
// REAUTH_REQUIRED, checked after the session 401, the role 403 and the
// same-origin 403, before input parsing and any DynamoDB call; no `denied`
// record and no audit record of any kind; reads are never gated),
// "Audit log" semantics and D17, "API routes (additions)" (POST
// /api/role-grants, DELETE /api/role-grants/[oid]/[role]), threats T30-T32.
// Routes to build: POST in role-grants/route.ts and DELETE in
// role-grants/[oid]/[role]/route.ts (slice 1 shipped GET only). Only `@/auth`
// is mocked; DynamoDB Local is real.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/dynamodb", () =>
  import("@/lib/data/access/access-test-support").then((m) =>
    m.faultyDynamodb(),
  ),
);
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const LIST = "/api/role-grants";
const item = (oid: string, role: string) => `/api/role-grants/${oid}/${role}`;
type CallExtra = Partial<Parameters<typeof invoke>[1]>;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const FRESH = () => nowSeconds() - 10;
const STALE = () => nowSeconds() - 901;

type SessionOptions = {
  authTime?: unknown;
  authMethod?: "entra" | "master" | "password" | "local";
};

// `authTime: undefined` leaves the claim out (a session issued before D28, or
// an Entra token with no valid auth_time).
function signInAs(caller: Caller | null, options: SessionOptions = {}) {
  vi.mocked(auth).mockResolvedValue(
    (caller === null
      ? null
      : {
          user: {
            ...SESSIONS[caller],
            roles: [...SESSIONS[caller].roles],
            authMethod: options.authMethod ?? "entra",
            ...("authTime" in options && options.authTime !== undefined
              ? { authTime: options.authTime }
              : {}),
          },
        }) as never,
  );
}

async function deleteHandler() {
  const mod = await import("./role-grants/[oid]/[role]/route");
  return mod.DELETE;
}

let seedCount = 0;
async function seed(
  oid: string,
  role: "internal-admin" | "internal-org-admin" = "internal-org-admin",
) {
  return ok(
    await grantRole(
      { oid, role, reason: "quarterly review" },
      ctxAt(undefined, `req-seed-${++seedCount}`),
    ),
  );
}

const stored = async () =>
  ok(await listRoleGrants({ cursorSecret: CURSOR_SECRET })).items;

const grantBody = (over: Record<string, unknown> = {}) => ({
  oid: "oid-target",
  role: "internal-org-admin",
  reason: "covering the platform rota",
  ...over,
});
const post = (body: unknown = grantBody(), extra: CallExtra = {}) =>
  invoke(POST, { method: "POST", path: LIST, body, ...extra });
const del = async (
  oid = "oid-target",
  role = "internal-org-admin",
  body: unknown = { version: 1 },
  extra: CallExtra = {},
) =>
  invoke(await deleteHandler(), {
    method: "DELETE",
    path: item(oid, role),
    params: { oid, role },
    body,
    ...extra,
  });

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  resetFaults();
  signInAs("admin", { authTime: FRESH() });
});

describe("POST /api/role-grants", () => {
  it("201 with the new grant, one role.grant security record, and the grant stored", async () => {
    const audit0 = (await auditToday()).length;
    const data = await expectData<Record<string, unknown>>(await post(), [201]);
    expect(data).toMatchObject({
      oid: "oid-target",
      role: "internal-org-admin",
      reason: "covering the platform rota",
      grantedBy: "oid-admin",
      version: 1,
    });
    expect(await stored()).toEqual([expect.objectContaining(data)]);
    const records = await auditToday();
    expect(records).toHaveLength(audit0 + 1);
    expect(records.at(-1)).toMatchObject({
      action: "role.grant",
      result: "success",
      category: "security",
      actor: "oid-admin",
      target: { type: "identity", id: "oid-target" },
    });
  });

  it("can grant internal-admin as well", async () => {
    await expectData(await post(grantBody({ role: "internal-admin" })), [201]);
    expect(await stored()).toEqual([
      expect.objectContaining({ oid: "oid-target", role: "internal-admin" }),
    ]);
  });

  it.each([
    ["a body that is not JSON", "{not json", {}],
    ["an empty object", {}, {}],
    ["a missing reason", { oid: "oid-target", role: "internal-admin" }, {}],
    ["an empty reason", grantBody({ reason: "" }), {}],
    ["a missing oid", grantBody({ oid: undefined }), {}],
    ["an empty oid", grantBody({ oid: "" }), {}],
    [
      "internal-auditor, which an app grant can never be",
      grantBody({ role: "internal-auditor" }),
      {},
    ],
    [
      "internal-viewer, which is not grantable",
      grantBody({ role: "internal-viewer" }),
      {},
    ],
    ["the legacy Admin alias", grantBody({ role: "Admin" }), {}],
    ["a non-string reason", grantBody({ reason: 7 }), {}],
    ["a wrong content type", grantBody(), { contentType: "text/plain" }],
  ])(
    "400 BAD_REQUEST for %s, with no write and no audit record",
    async (_n, body, extra) => {
      const before = await nonAuditItems();
      const audit0 = (await auditToday()).length;
      await expectError(await post(body, extra), 400, "BAD_REQUEST");
      expect(await nonAuditItems()).toEqual(before);
      expect(await auditToday()).toHaveLength(audit0);
    },
  );

  it("409 CONFLICT for a grant that already exists, with no new audit record", async () => {
    await seed("oid-target");
    const audit0 = (await auditToday()).length;
    await expectError(await post(), 409, "CONFLICT");
    expect(await stored()).toHaveLength(1);
    expect(await auditToday()).toHaveLength(audit0);
  });
});

describe("DELETE /api/role-grants/[oid]/[role]", () => {
  it("200 with { oid, role }, the grant removed and one role.revoke security record", async () => {
    await seed("oid-target");
    const audit0 = (await auditToday()).length;
    const data = await expectData<{ oid: string; role: string }>(await del());
    expect(data).toEqual({ oid: "oid-target", role: "internal-org-admin" });
    expect(await stored()).toEqual([]);
    const records = await auditToday();
    expect(records).toHaveLength(audit0 + 1);
    expect(records.at(-1)).toMatchObject({
      action: "role.revoke",
      result: "success",
      category: "security",
      actor: "oid-admin",
      target: { type: "identity", id: "oid-target" },
    });
  });

  it("404 NOT_FOUND for a grant that does not exist, with no audit record", async () => {
    const audit0 = (await auditToday()).length;
    await expectError(await del("oid-nobody"), 404, "NOT_FOUND");
    expect(await auditToday()).toHaveLength(audit0);
  });

  // 4R.4 review nit: a grant that is not there is NOT_FOUND whatever the role;
  // the last-admin guard speaks only about a grant that exists (Roles; Error-
  // code registry: 404 NOT_FOUND).
  it.each([
    ["no other internal-admin grant exists", false],
    ["another internal-admin grant exists", true],
  ])(
    "404 NOT_FOUND for a missing internal-admin grant when %s, not 409",
    async (_n, withOther) => {
      if (withOther) await seed("oid-admin-b", "internal-admin");
      const audit0 = (await auditToday()).length;
      await expectError(
        await del("oid-nobody", "internal-admin"),
        404,
        "NOT_FOUND",
      );
      expect(await auditToday()).toHaveLength(audit0);
    },
  );

  it("409 CONFLICT for a stale version, the grant stays", async () => {
    await seed("oid-target");
    const audit0 = (await auditToday()).length;
    await expectError(
      await del("oid-target", "internal-org-admin", { version: 9 }),
      409,
      "CONFLICT",
    );
    expect(await stored()).toHaveLength(1);
    expect(await auditToday()).toHaveLength(audit0);
  });

  it.each([
    ["a missing version", {}],
    ["a zero version", { version: 0 }],
    ["a non-integer version", { version: 1.5 }],
    ["a string version", { version: "1" }],
    ["a body that is not JSON", "{not json"],
  ])("400 BAD_REQUEST for %s", async (_n, body) => {
    await seed("oid-target");
    await expectError(
      await del("oid-target", "internal-org-admin", body),
      400,
      "BAD_REQUEST",
    );
    expect(await stored()).toHaveLength(1);
  });

  it.each(["internal-auditor", "internal-viewer", "Admin", "root"])(
    "400 BAD_REQUEST for the path role %s (not a grantable role)",
    async (role) => {
      await expectError(await del("oid-target", role), 400, "BAD_REQUEST");
    },
  );

  // Spec - Roles: "The last internal-admin cannot be revoked (409)". The
  // routes can only count in-app internal-admin grants.
  it("409 CONFLICT when revoking the only internal-admin grant, which stays", async () => {
    await seed("oid-only-admin", "internal-admin");
    const audit0 = (await auditToday()).length;
    await expectError(
      await del("oid-only-admin", "internal-admin"),
      409,
      "CONFLICT",
    );
    expect(await stored()).toHaveLength(1);
    expect(await auditToday()).toHaveLength(audit0);
  });

  it("revokes an internal-admin grant when another internal-admin grant remains", async () => {
    await seed("oid-admin-a", "internal-admin");
    await seed("oid-admin-b", "internal-admin");
    await expectData(await del("oid-admin-a", "internal-admin"));
    expect(await stored()).toEqual([
      expect.objectContaining({ oid: "oid-admin-b" }),
    ]);
  });

  // F5 (run-r4b decisions): the last-admin check is atomic with the revoke, so
  // two concurrent revokes cannot both pass it (Access Control spec - Roles).
  it("F5: two concurrent revokes of the only two internal-admin grants: one 200, one 409 CONFLICT, one grant remains", async () => {
    await seed("oid-admin-a", "internal-admin");
    await seed("oid-admin-b", "internal-admin");
    const results = await Promise.all([
      del("oid-admin-a", "internal-admin"),
      del("oid-admin-b", "internal-admin"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    await expectError(results.find((r) => r.status === 409)!, 409, "CONFLICT");
    expect(await stored()).toHaveLength(1);
    const revokes = (await auditToday()).filter(
      (r) => r.action === "role.revoke",
    );
    expect(revokes).toHaveLength(1);
  });

  // F5 hardening (run-r4b decisions): a DynamoDB TransactionConflict from a
  // racing revoke is a retryable 409 CONFLICT, not a 500.
  it("F5: a TransactionConflict while revoking answers 409 CONFLICT and the grants stay", async () => {
    await seed("oid-admin-a", "internal-admin");
    await seed("oid-admin-b", "internal-admin");
    const audit0 = (await auditToday()).length;
    faults.transactConflictAt = 0;
    await expectError(
      await del("oid-admin-a", "internal-admin"),
      409,
      "CONFLICT",
    );
    faults.transactConflictAt = null;
    expect(await stored()).toHaveLength(2);
    expect(await auditToday()).toHaveLength(audit0);
  });

  it("the sole internal-org-admin grant can be revoked (only internal-admin is protected)", async () => {
    await seed("oid-org");
    await seed("oid-admin-a", "internal-admin");
    await expectData(await del("oid-org"));
  });
});

// Source: Recent authentication (D28); T30 (fresh / stale / missing per
// method; order against 401, FORBIDDEN, cross-origin and 400).
type Method = "POST" | "DELETE";
const METHODS: Method[] = ["POST", "DELETE"];

async function send(
  method: Method,
  extra: { body?: unknown; origin?: string | null; target?: string } = {},
) {
  const target = extra.target ?? "oid-target";
  if (method === "POST") {
    return post(
      extra.body ?? grantBody({ oid: target }),
      extra.origin === undefined ? {} : { origin: extra.origin },
    );
  }
  return del(
    target,
    "internal-org-admin",
    extra.body ?? { version: 1 },
    extra.origin === undefined ? {} : { origin: extra.origin },
  );
}

describe.each(METHODS)("%s role grant: recent authentication", (method) => {
  beforeEach(async () => {
    if (method === "DELETE") await seed("oid-target");
  });

  it.each(["entra", "master", "password"] as const)(
    "a fresh %s sign-in proceeds, and a bad body is 400",
    async (authMethod) => {
      signInAs("admin", { authTime: FRESH(), authMethod });
      await expectError(
        await send(method, { body: method === "POST" ? {} : "{not json" }),
        400,
        "BAD_REQUEST",
      );
      const data = await expectData(await send(method), [200, 201]);
      expect(data).toBeTruthy();
      const records = await auditToday();
      expect(records.at(-1)).toMatchObject({
        action: method === "POST" ? "role.grant" : "role.revoke",
        result: "success",
      });
    },
  );

  it("accepts a sign-in time up to 60 seconds ahead (clock skew)", async () => {
    signInAs("admin", { authTime: nowSeconds() + 30 });
    await expectData(await send(method), [200, 201]);
  });

  describe.each([
    ["stale (901 s old)", () => STALE()],
    ["very old", () => nowSeconds() - 86_400],
    ["too far in the future", () => nowSeconds() + 3600],
    ["missing", () => undefined],
    ["null", () => null],
    ["a numeric string", () => String(nowSeconds())],
    ["NaN", () => Number.NaN],
  ] as [string, () => unknown][])("authTime %s", (_name, authTime) => {
    beforeEach(() => signInAs("admin", { authTime: authTime() }));

    it("403 REAUTH_REQUIRED with the standard body and no-store, nothing changed, no audit record of any kind", async () => {
      const before = await nonAuditItems();
      const audit0 = (await auditToday()).length;
      const body = await expectError(
        await send(method),
        403,
        "REAUTH_REQUIRED",
      );
      expect(body.error.message).toBe("Re-authentication required");
      expect(await nonAuditItems()).toEqual(before);
      expect(await auditToday()).toHaveLength(audit0);
      expect(await deniedToday()).toEqual([]);
    });

    it("answers REAUTH_REQUIRED before parsing the body (not 400)", async () => {
      await expectError(
        await send(method, { body: "{not json" }),
        403,
        "REAUTH_REQUIRED",
      );
      await expectError(
        await send(method, { body: {} }),
        403,
        "REAUTH_REQUIRED",
      );
    });
  });

  describe("order of checks", () => {
    it("a stale non-admin gets 403 FORBIDDEN (never REAUTH_REQUIRED) and exactly one denied record", async () => {
      signInAs("viewer", { authTime: STALE() });
      const body = await expectError(await send(method), 403, "FORBIDDEN");
      expect(body.error.message).toBe("internal-admin role required");
      const denied = await deniedToday();
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({
        action: method === "POST" ? "role.grant" : "role.revoke",
        result: "denied",
        code: "FORBIDDEN",
      });
    });

    it("a missing-authTime non-admin also gets 403 FORBIDDEN", async () => {
      signInAs("orgAdmin");
      await expectError(await send(method), 403, "FORBIDDEN");
    });

    it("a stale admin with a cross-origin request gets 403 FORBIDDEN, not REAUTH_REQUIRED", async () => {
      signInAs("admin", { authTime: STALE() });
      for (const origin of [null, "https://evil.example.test", "null"]) {
        const body = await expectError(
          await send(method, { origin }),
          403,
          "FORBIDDEN",
        );
        expect(body.error.message).toBe("Cross-origin request rejected");
      }
      expect(await deniedToday()).toEqual([]);
    });

    it("a fresh admin with a cross-origin request is still 403 FORBIDDEN", async () => {
      signInAs("admin", { authTime: FRESH() });
      await expectError(
        await send(method, { origin: "https://evil.example.test" }),
        403,
        "FORBIDDEN",
      );
    });

    it("a stale admin with an invalid body gets REAUTH_REQUIRED, not 400", async () => {
      signInAs("admin", { authTime: STALE() });
      await expectError(
        await send(method, { body: { nonsense: true } }),
        403,
        "REAUTH_REQUIRED",
      );
    });
  });
});

describe("DELETE role grant: REAUTH_REQUIRED reveals nothing about the target", () => {
  it("a stale DELETE of a missing target has a body identical to one of an existing target", async () => {
    await seed("oid-exists");
    signInAs("admin", { authTime: STALE() });
    const existing = await expectError(
      await del("oid-exists"),
      403,
      "REAUTH_REQUIRED",
    );
    const missing = await expectError(
      await del("oid-never-existed", "internal-admin", { version: 7 }),
      403,
      "REAUTH_REQUIRED",
    );
    expect(missing).toEqual(existing);
  });
});

describe("reads are never gated by recent authentication", () => {
  it.each(["admin", "auditor"] as const)(
    "a stale %s lists the grants with GET /api/role-grants (200)",
    async (caller) => {
      await seed("oid-one");
      signInAs(caller, { authTime: STALE() });
      const data = await expectData<{ items: unknown[] }>(
        await invoke(GET, { method: "GET", path: LIST }),
      );
      expect(data.items).toHaveLength(1);
    },
  );

  it("a session with no authTime lists the grants too", async () => {
    signInAs("admin");
    await expectData(await invoke(GET, { method: "GET", path: LIST }));
  });
});
