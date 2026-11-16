import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/support/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/test/support/access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  ACTOR,
  DAY,
  NOW,
  faults,
  resetFaults,
} from "@/test/support/access-test-support";
import {
  appendAuditRecord,
  appendDeniedAudit,
  getDeniedSuppressedCount,
  listAuditRecords,
  resetDeniedAudit,
} from "./audit";

// Source: docs/specs/2026-11-10-access-control.md — "Audit log" (schema,
// semantics, Denied attempts D17, retention D3 = 400 days), threats T17, T18,
// T22; contract R2 decision 4 (SK `{timestamp}#{requestId}#{nn}`) and addendum
// B.2. Only the AUDIT# items are read raw here (addendum B.6).
// Assumed API: appendAuditRecord(record, index = 0);
// appendDeniedAudit({ actor, action, requestId, target?, teamId?, now? }) →
// { written: true } | { suppressed: true } | { written: false };
// getDeniedSuppressedCount(): number; resetDeniedAudit(): void;
// listAuditRecords(utcDay): Promise<AuditRecord[]> ordered by SK.
const T0 = NOW.toISOString();
const base = {
  actor: ACTOR,
  action: "affiliation.add" as const,
  category: "change" as const,
  target: { type: "team", id: "t1" },
  result: "success" as const,
  timestamp: T0,
  requestId: "req-1",
};

async function rawAudit(day = DAY) {
  const r = await testDoc().send(
    new QueryCommand({
      TableName: TEST_TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": `AUDIT#${day}` },
    }),
  );
  return r.Items ?? [];
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
  resetDeniedAudit();
});

describe("appendAuditRecord", () => {
  it("stores under AUDIT#{day} with SK {timestamp}#{requestId}#{nn}", async () => {
    await appendAuditRecord(base);
    await appendAuditRecord({ ...base, requestId: "req-2" }, 3);
    const items = await rawAudit();
    expect(items.map((i) => i.SK)).toEqual([
      `${T0}#req-1#00`,
      `${T0}#req-2#03`,
    ]);
    expect(items[0]).toMatchObject({ PK: `AUDIT#${DAY}`, actor: ACTOR });
  });

  it("sets expiresAt to timestamp + 400 days in epoch seconds", async () => {
    await appendAuditRecord(base);
    const [item] = await rawAudit();
    expect(item?.expiresAt).toBe(
      Math.floor(NOW.getTime() / 1000) + 400 * 86_400,
    );
  });

  it("keeps several records of one request distinct", async () => {
    await appendAuditRecord(base, 0);
    await appendAuditRecord(base, 1);
    expect(await rawAudit()).toHaveLength(2);
  });

  it("sanitises before/after to allowlisted keys (T17)", async () => {
    await appendAuditRecord({
      ...base,
      before: {
        teamId: "t1",
        password: "hunter2",
        totpSecret: "JBSWY3DP",
        passwordHash: "$argon2id$x",
        token: "tok",
        claims: { a: 1 },
        groups: ["g1"],
      },
      after: { teamId: "t2", nested: { deep: true } },
    } as never);
    const [item] = await rawAudit();
    expect(item?.before).toEqual({ teamId: "t1" });
    expect(item?.after).toEqual({ teamId: "t2" });
    expect(JSON.stringify(item)).not.toMatch(/hunter2|JBSWY3DP|argon2id|tok"/);
  });

  it("lists a day's records in SK order and ignores other days", async () => {
    await appendAuditRecord({ ...base, requestId: "req-b" });
    await appendAuditRecord({ ...base, requestId: "req-a" });
    await appendAuditRecord({
      ...base,
      timestamp: "2026-11-15T00:00:01.000Z",
    });
    const records = await listAuditRecords(DAY);
    expect(records.map((r) => r.requestId)).toEqual(["req-a", "req-b"]);
    expect(await listAuditRecords("2026-11-16")).toEqual([]);
  });
});

describe("audit append-only (T18, T19)", () => {
  it("rejects a record whose SK already exists instead of overwriting it", async () => {
    await appendAuditRecord(base);
    await expect(
      appendAuditRecord({ ...base, actor: "someone-else" }),
    ).rejects.toThrow();
    const items = await rawAudit();
    expect(items).toHaveLength(1);
    expect(items[0]?.actor).toBe(ACTOR);
  });
});

describe("appendDeniedAudit (D17, T22)", () => {
  const denied = {
    actor: ACTOR,
    action: "role.grant" as const,
    requestId: "req-d1",
    code: "FORBIDDEN" as const,
    now: NOW,
  };

  it("writes one denied security record and omits an unknown target", async () => {
    expect(await appendDeniedAudit(denied)).toMatchObject({ written: true });
    const items = await rawAudit();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      actor: ACTOR,
      action: "role.grant",
      result: "denied",
      category: "security",
      requestId: "req-d1",
    });
    expect(items[0]).not.toHaveProperty("target");
    expect(items[0]).not.toHaveProperty("teamId");
  });

  it("stores the error code, and the route only when given", async () => {
    await appendDeniedAudit({
      ...denied,
      code: "PRIVILEGED_TARGET",
      route: { method: "PATCH", pattern: "/api/accounts/[id]" },
    });
    await appendDeniedAudit({
      ...denied,
      actor: "other-oid",
      requestId: "req-d9",
      code: "NOT_FOUND",
    });
    const items = await rawAudit();
    expect(items).toHaveLength(2);
    const withRoute = items.find((i) => i.actor === ACTOR);
    const without = items.find((i) => i.actor === "other-oid");
    expect(withRoute).toMatchObject({
      code: "PRIVILEGED_TARGET",
      route: { method: "PATCH", pattern: "/api/accounts/[id]" },
    });
    expect(without).toMatchObject({ code: "NOT_FOUND" });
    expect(without).not.toHaveProperty("route");
    const records = await listAuditRecords(DAY);
    expect(records.map((r) => r.code).sort()).toEqual([
      "NOT_FOUND",
      "PRIVILEGED_TARGET",
    ]);
  });

  it("is a security record even for a change action", async () => {
    await appendDeniedAudit({ ...denied, action: "affiliation.add" });
    const [record] = await listAuditRecords(DAY);
    expect(record).toMatchObject({ result: "denied", category: "security" });
  });

  it("records target and teamId when the caller passes validated ids", async () => {
    await appendDeniedAudit({
      ...denied,
      target: { type: "team", id: "t9" },
      teamId: "t9",
    });
    const [item] = await rawAudit();
    expect(item).toMatchObject({
      target: { type: "team", id: "t9" },
      teamId: "t9",
    });
  });

  it("suppresses a repeat for the same actor+action within 60 s", async () => {
    await appendDeniedAudit(denied);
    const again = await appendDeniedAudit({
      ...denied,
      requestId: "req-d2",
      now: new Date(NOW.getTime() + 59_000),
    });
    expect(again).toMatchObject({ suppressed: true });
    expect(await rawAudit()).toHaveLength(1);
    expect(getDeniedSuppressedCount()).toBe(1);
  });

  it("allows the same actor+action again after 60 s", async () => {
    await appendDeniedAudit(denied);
    const later = await appendDeniedAudit({
      ...denied,
      requestId: "req-d3",
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(later).toMatchObject({ written: true });
    expect(await rawAudit()).toHaveLength(2);
    expect(getDeniedSuppressedCount()).toBe(0);
  });

  it("does not suppress a different action or a different actor", async () => {
    await appendDeniedAudit(denied);
    await appendDeniedAudit({
      ...denied,
      action: "role.revoke",
      requestId: "r2",
    });
    await appendDeniedAudit({ ...denied, actor: "other-oid", requestId: "r3" });
    expect(await rawAudit()).toHaveLength(3);
    expect(getDeniedSuppressedCount()).toBe(0);
  });

  it("returns { written: false } instead of throwing when the write fails", async () => {
    faults.put = true;
    await expect(appendDeniedAudit(denied)).resolves.toMatchObject({
      written: false,
    });
    faults.put = false;
    expect(await rawAudit()).toHaveLength(0);
  });
});
