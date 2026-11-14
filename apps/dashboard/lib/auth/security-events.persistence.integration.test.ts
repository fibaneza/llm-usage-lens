import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/lib/data/access/access-test-support").then((m) =>
    m.faultyDynamodb(),
  ),
);
const m = vi.hoisted(() => ({
  recordException: vi.fn(),
  addEvent: vi.fn(),
}));
vi.mock("@opentelemetry/api", async (orig) => {
  const actual = await orig<typeof import("@opentelemetry/api")>();
  return {
    ...actual,
    trace: {
      ...actual.trace,
      getActiveSpan: () => ({
        addEvent: m.addEvent,
        recordException: m.recordException,
      }),
    },
  };
});
const deliver = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/data/access/audit-delivery", () => ({
  deliverAuditLine: deliver,
}));

import { recordSecurityEvent } from "@/lib/auth/security-events";
import type { SecurityEvent } from "@/lib/auth/security-events";
import {
  auditRecords,
  faults,
  resetFaults,
} from "@/lib/data/access/access-test-support";

// Source: docs/specs/2026-11-10-access-control.md — "Audit log" (security
// events are security records), threat T20 (each master-user event persists
// one record with category security and delivers one CloudWatch line; a
// persistence failure on a master sign-in fails that sign-in; failures on
// other events are recorded, not thrown); contract R2 §1 decisions 14-15.
const AT = "2026-11-14T10:00:00.000Z";
const OID = "master:master-admin";

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
  m.recordException.mockReset();
  m.addEvent.mockReset();
  deliver.mockClear();
});

const event = (
  action: SecurityEvent["action"],
  extra: Partial<SecurityEvent> & {
    requestId?: string;
    sequence?: { next: number };
  } = {},
) => ({
  action,
  result:
    action === "auth.master.signin"
      ? ("success" as const)
      : ("failed" as const),
  oid: OID,
  at: AT,
  ...extra,
});

describe("recordSecurityEvent persistence (T20)", () => {
  it.each([
    "auth.master.signin",
    "auth.master.failure",
    "auth.master.lockout",
    "auth.signin.error",
  ] as const)(
    "%s persists exactly one security-category record",
    async (action) => {
      await recordSecurityEvent(event(action, { requestId: "req-sec" }));
      const records = await auditRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action,
        category: "security",
        result: action === "auth.master.signin" ? "success" : "failed",
        actor: OID,
        timestamp: AT,
        requestId: "req-sec",
      });
      expect(records[0]?.target).toBeDefined();
    },
  );

  it("persists an auth.signin.error without an oid under a system actor", async () => {
    await recordSecurityEvent({
      action: "auth.signin.error",
      result: "failed",
      at: AT,
      requestId: "req-err",
    });
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ actor: "system", category: "security" });
  });

  it("generates a requestId on the server when none is supplied", async () => {
    await recordSecurityEvent(event("auth.master.failure"));
    const [record] = await auditRecords();
    expect(record?.requestId).toEqual(expect.any(String));
    expect(record?.requestId.length).toBeGreaterThan(0);
  });

  it("delivers the CloudWatch line for each persisted record", async () => {
    await recordSecurityEvent(
      event("auth.master.failure", { requestId: "req-1" }),
    );
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]?.[0]).toMatchObject({
      action: "auth.master.failure",
      category: "security",
      requestId: "req-1",
    });
  });

  it("stores no credential material: the record carries only allowlisted fields", async () => {
    await recordSecurityEvent(event("auth.master.failure"));
    const text = JSON.stringify(await auditRecords());
    expect(text).not.toMatch(/password|totp|hash|secret/i);
  });
});

describe("recordSecurityEvent persistence failures", () => {
  it("rejects for a master sign-in so the sign-in fails", async () => {
    faults.put = true;
    await expect(
      recordSecurityEvent(event("auth.master.signin")),
    ).rejects.toThrow();
  });

  it.each([
    "auth.master.failure",
    "auth.master.lockout",
    "auth.signin.error",
  ] as const)(
    "does not throw for %s, records the exception on the span",
    async (action) => {
      faults.put = true;
      await expect(recordSecurityEvent(event(action))).resolves.toBeUndefined();
      expect(m.recordException).toHaveBeenCalledTimes(1);
    },
  );

  it("still delivers the CloudWatch line when the PutItem fails", async () => {
    faults.put = true;
    await recordSecurityEvent(
      event("auth.master.failure", { requestId: "req-x" }),
    );
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("still emits the OpenTelemetry event when persistence fails", async () => {
    faults.put = true;
    await recordSecurityEvent(event("auth.master.lockout"));
    expect(m.addEvent).toHaveBeenCalledTimes(1);
  });
});

describe("recordSecurityEvent shared audit sequence", () => {
  it("takes the supplied sequence index and advances it, so a second record at the same timestamp and request id does not collide", async () => {
    const sequence = { next: 2 };
    await recordSecurityEvent(
      event("auth.signin.error", { requestId: "req-seq", sequence }),
    );
    expect(sequence.next).toBe(3);
    await recordSecurityEvent(
      event("auth.signin.error", { requestId: "req-seq", sequence }),
    );
    expect(sequence.next).toBe(4);
    const records = await auditRecords();
    expect(records.filter((r) => r.requestId === "req-seq")).toHaveLength(2);
  });
});
