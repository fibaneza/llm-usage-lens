import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("./access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  NOW,
  OID_A,
  auditRecords,
  faults,
  resetFaults,
} from "./access-test-support";
import { recordSignIn, recordSignOut } from "./session-audit";

// Source: docs/specs/2026-11-10-access-control.md — "Audit log" D18: every
// successful sign-in writes `auth.signin.success` and every explicit sign-out
// `auth.signout`, with the method (entra, master, password, local) and no
// claims; they are change records, not security events. (Entra sign-ins are
// written inside the sign-in sync transaction; this module serves the other
// methods and sign-out.)
beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("recordSignIn / recordSignOut", () => {
  it.each(["master", "password", "local"] as const)(
    "recordSignIn writes one change record carrying the %s method",
    async (method) => {
      await recordSignIn({ oid: OID_A, method, requestId: "req-1", now: NOW });
      const records = await auditRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        actor: OID_A,
        action: "auth.signin.success",
        category: "change",
        result: "success",
        target: { type: "identity", id: OID_A },
        after: { method },
        timestamp: NOW.toISOString(),
        requestId: "req-1",
      });
    },
  );

  it("recordSignOut writes one auth.signout change record with the method", async () => {
    await recordSignOut({
      oid: OID_A,
      method: "entra",
      requestId: "req-2",
      now: NOW,
    });
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actor: OID_A,
      action: "auth.signout",
      category: "change",
      result: "success",
      after: { method: "entra" },
    });
  });

  it("a persistence failure rejects, so the caller can fail the sign-in", async () => {
    faults.put = true;
    await expect(
      recordSignIn({
        oid: OID_A,
        method: "master",
        requestId: "req-3",
        now: NOW,
      }),
    ).rejects.toThrow();
  });
});
