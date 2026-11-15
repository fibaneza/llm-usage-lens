import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { GOVERNANCE_PK } from "@/lib/data/access/access-test-support";
import { resetDeniedAudit } from "@/lib/data/access/audit";
import {
  PER_USER_SK,
  getPerUserApproval,
} from "@/lib/data/access/per-user-approval";
import {
  auditToday,
  deniedToday,
  expectData,
  expectError,
  invoke,
  nonAuditItems,
  signInAs,
} from "@/test/governance-route-support";
import { clearTable, ensureTestTable, putRaw } from "@/test/test-support";

import {
  GET as getApproval,
  PUT as putApproval,
} from "./governance/per-user-approval/route";

// Source: docs/specs/2026-11-10-access-control.md - "Visibility and
// inheritance" (organisation cap: an internal-admin records who, when and the
// works-council / data-protection reference; audited), "API routes
// (additions)" (/api/governance/per-user-approval PUT internal-admin),
// "Enforcement" items 2 (403 before parsing), 4 (no-store), 6 (Zod, version ->
// 409, same-origin, JSON content type), "Audit log" (governance.approval.update:
// one success record in the transaction; 400 and 409 write none; one `denied`
// record per authorization refusal with a fixed route pattern, D17/T22),
// threat T16. Contract: temp/run-r4/run-r4/contract-slice3.md. Only `@/auth`
// is mocked. Decisions: `version` is the stored version (0 when nothing is
// recorded); who is always the session oid (a body `approvedBy` is ignored);
// withdrawing the approval is not defined by the spec and is out of scope.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const APPROVAL = "/api/governance/per-user-approval";
const NOW = new Date("2026-11-15T09:30:00.000Z");

const put = (body: unknown, extra = {}) =>
  invoke(putApproval, { method: "PUT", path: APPROVAL, body, ...extra });

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  signInAs("admin");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("PUT /api/governance/per-user-approval", () => {
  it("records the first approval: who = session oid, when = now, reference, version 1, returned in the GET shape", async () => {
    const data = await expectData(
      await put({ reference: "WC-2026-14", version: 0 }),
    );
    expect(data).toEqual({
      approved: true,
      approvedBy: "oid-admin",
      approvedAt: NOW.toISOString(),
      reference: "WC-2026-14",
      version: 1,
    });
    expect(await getPerUserApproval()).toEqual({
      approvedBy: "oid-admin",
      approvedAt: NOW.toISOString(),
      reference: "WC-2026-14",
      version: 1,
    });
    signInAs("auditor");
    expect(
      await expectData(
        await invoke(getApproval, { method: "GET", path: APPROVAL }),
      ),
    ).toMatchObject({ approved: true, reference: "WC-2026-14", version: 1 });
  });

  it("writes exactly one governance.approval.update success record", async () => {
    await expectData(await put({ reference: "WC-2026-14", version: 0 }));
    const records = await auditToday();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "governance.approval.update",
      category: "change",
      result: "success",
      actor: "oid-admin",
    });
  });

  it("ignores a body approvedBy: the approver is never client-supplied", async () => {
    const data = await expectData<{ approvedBy: string }>(
      await put({ reference: "r", version: 0, approvedBy: "oid-someone-else" }),
    );
    expect(data.approvedBy).toBe("oid-admin");
    expect((await getPerUserApproval())?.approvedBy).toBe("oid-admin");
  });

  it("re-approves at the current version, bumping it, with a second audit record", async () => {
    await expectData(await put({ reference: "first", version: 0 }));
    const data = await expectData(
      await put({ reference: "second", version: 1 }),
    );
    expect(data).toMatchObject({ reference: "second", version: 2 });
    expect(await auditToday()).toHaveLength(2);
  });

  it.each([
    ["1 character", "r"],
    ["200 characters", "r".repeat(200)],
  ])("accepts a reference of %s", async (_n, reference) => {
    await expectData(await put({ reference, version: 0 }));
  });

  it("409 CONFLICT for a stale version; state unchanged, no audit record, no denied record", async () => {
    await expectData(await put({ reference: "first", version: 0 }));
    const audit0 = (await auditToday()).length;
    await expectError(
      await put({ reference: "x", version: 0 }),
      409,
      "CONFLICT",
    );
    await expectError(
      await put({ reference: "x", version: 9 }),
      409,
      "CONFLICT",
    );
    expect(await getPerUserApproval()).toMatchObject({
      reference: "first",
      version: 1,
    });
    expect(await auditToday()).toHaveLength(audit0);
    expect(await deniedToday()).toEqual([]);
  });

  it("409 CONFLICT for a non-zero version when nothing is recorded", async () => {
    await expectError(
      await put({ reference: "x", version: 2 }),
      409,
      "CONFLICT",
    );
    expect(await getPerUserApproval()).toBeNull();
    expect(await auditToday()).toEqual([]);
  });

  it.each([
    [
      "no Content-Type",
      { contentType: null, body: { reference: "x", version: 0 } },
    ],
    [
      "text/plain",
      { contentType: "text/plain", body: { reference: "x", version: 0 } },
    ],
    ["invalid JSON", { body: "{not json" }],
    ["an empty object", { body: {} }],
    ["a missing reference", { body: { version: 0 } }],
    ["an empty reference", { body: { reference: "", version: 0 } }],
    [
      "a 201-character reference",
      { body: { reference: "r".repeat(201), version: 0 } },
    ],
    ["a numeric reference", { body: { reference: 12, version: 0 } }],
    ["a null reference", { body: { reference: null, version: 0 } }],
    ["a missing version", { body: { reference: "x" } }],
    ["a string version", { body: { reference: "x", version: "0" } }],
    ["a fractional version", { body: { reference: "x", version: 0.5 } }],
    ["a negative version", { body: { reference: "x", version: -1 } }],
    ["a non-object body", { body: "[]" }],
  ])(
    "400 BAD_REQUEST for %s; nothing stored, no audit record of any kind",
    async (_name, call) => {
      await expectError(
        await invoke(putApproval, { method: "PUT", path: APPROVAL, ...call }),
        400,
        "BAD_REQUEST",
      );
      expect(await nonAuditItems()).toEqual([]);
      expect(await auditToday()).toEqual([]);
    },
  );

  it("leaves a previously recorded approval untouched on a 400", async () => {
    await putRaw({
      PK: GOVERNANCE_PK,
      SK: PER_USER_SK,
      approvedBy: "oid-admin",
      approvedAt: "2026-11-01T00:00:00.000Z",
      reference: "WC-1",
      version: 1,
    });
    await expectError(
      await put({ reference: "", version: 1 }),
      400,
      "BAD_REQUEST",
    );
    expect(await getPerUserApproval()).toMatchObject({
      reference: "WC-1",
      version: 1,
    });
  });
});
