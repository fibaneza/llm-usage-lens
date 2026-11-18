import {
  BatchWriteCommand,
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/support/test-support";

import { listResetsOf, listTeamResets } from "./budget-reset-counts";
import { budgetResetPutItem } from "./budget-resets";

// Sources: LiteLLM spec - MG-D8 (the BudgetReset ledger item: fields, written
// append-only, expires after 400 days, the audit retention); MG-D9 (the count
// covers the UTC date range); Data Model - "Budget reset entities (unit M4)"
// (BudgetReset keys: PK BRESET#TEAM#{teamId}, SK {timestamp}#{resetId}, GSI1
// BRESETS#IDENT#{oid}; "Reset counts" access pattern: Query by SK range,
// paginated on LastEvaluatedKey, Rule 20.6); Rule 20.1 (UTC). The route-level
// outcomes are in app/api/budget-resets and the two reset routes.
beforeAll(ensureTestTable);
beforeEach(clearTable);

const OID = "00000000-0000-4000-8000-0000000000c1";
const RESET_ID = "00000000-0000-4000-8000-000000000001";
const TS = "2026-11-14T10:00:00.000Z";
const reset = {
  resetId: RESET_ID,
  oid: OID,
  teamId: "team-a",
  departmentId: "dept-eng",
  litellmTeamId: "lt-team-a",
  litellmUserId: "a1@company.com",
  operation: "spend" as const,
  amount: 3.25,
  budget: 10 as number | null,
  trigger: "direct" as const,
  actorOid: "00000000-0000-4000-8000-0000000000a1",
  requestId: "req-1",
  timestamp: TS,
};

const write = (item: ReturnType<typeof budgetResetPutItem>) =>
  testDoc().send(new TransactWriteCommand({ TransactItems: [item] }));

describe("budgetResetPutItem (MG-D8; Data Model - BudgetReset)", () => {
  it("stores the item under the spec keys with a 400-day expiry", async () => {
    await write(budgetResetPutItem(reset));
    const sk = `${TS}#${RESET_ID}`;
    const { Item } = await testDoc().send(
      new GetCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "BRESET#TEAM#team-a", SK: sk },
      }),
    );
    expect(Item).toMatchObject({
      ...reset,
      gsi1pk: `BRESETS#IDENT#${OID}`,
      gsi1sk: sk,
      expiresAt: Date.parse(TS) / 1000 + 400 * 86_400,
    });
  });

  it("keeps a null budget (a member with no limit set) rather than dropping it", async () => {
    await write(budgetResetPutItem({ ...reset, budget: null }));
    const rows = await listTeamResets("team-a", "2026-11-14", "2026-11-14");
    expect(rows).toEqual([{ oid: OID, amount: 3.25 }]);
  });

  it("is append-only: a second Put of the same key fails its condition and changes nothing", async () => {
    await write(budgetResetPutItem(reset));
    await expect(
      write(budgetResetPutItem({ ...reset, amount: 99 })),
    ).rejects.toThrow();
    expect(await listTeamResets("team-a", "2026-11-14", "2026-11-14")).toEqual([
      { oid: OID, amount: 3.25 },
    ]);
  });

  it.each([
    ["a negative amount", { amount: -1 }],
    ["an unknown trigger", { trigger: "schedule" }],
    ["an unknown operation", { operation: "delete" }],
    ["a timestamp that is not ISO 8601", { timestamp: "yesterday" }],
    ["an empty team id", { teamId: "" }],
    ["an unknown extra field", { note: "x" }],
  ])(
    "refuses %s before anything is written (Zod at the write)",
    (_n, patch) => {
      expect(() =>
        budgetResetPutItem({ ...reset, ...patch } as typeof reset),
      ).toThrow();
    },
  );
});

describe("the ledger reads (MG-D9; Data Model - Reset counts)", () => {
  it("per team and per person, inclusive of the whole of dateTo (UTC) and nothing of the next day", async () => {
    for (const [n, ts] of [
      [1, "2026-11-13T23:59:59.999Z"],
      [2, "2026-11-14T00:00:00.000Z"],
      [3, "2026-11-14T23:59:59.999Z"],
      [4, "2026-11-15T00:00:00.000Z"],
    ] as const) {
      await write(
        budgetResetPutItem({
          ...reset,
          resetId: `00000000-0000-4000-8000-00000000010${n}`,
          timestamp: ts,
          amount: n,
        }),
      );
    }
    const day = (
      await listTeamResets("team-a", "2026-11-14", "2026-11-14")
    ).map((r) => r.amount);
    expect(day.sort()).toEqual([2, 3]);
    const person = await listResetsOf(OID, "2026-11-14", "2026-11-14");
    expect(person.map((r) => r.amount).sort()).toEqual([2, 3]);
  });

  it("keeps teams and people apart: another team's or person's items are never returned", async () => {
    await write(budgetResetPutItem(reset));
    await write(
      budgetResetPutItem({
        ...reset,
        resetId: "00000000-0000-4000-8000-000000000002",
        teamId: "team-b",
        oid: "00000000-0000-4000-8000-0000000000c2",
      }),
    );
    expect(await listTeamResets("team-a", "2026-11-14", "2026-11-14")).toEqual([
      { oid: OID, amount: 3.25 },
    ]);
    expect(await listResetsOf(OID, "2026-11-14", "2026-11-14")).toHaveLength(1);
    expect(
      await listTeamResets("team-zzz", "2026-11-14", "2026-11-14"),
    ).toEqual([]);
  });

  it("follows LastEvaluatedKey: a team with more than one 1 MB page is counted whole (Rule 20.6)", async () => {
    const pad = "x".repeat(3_000);
    const total = 500; // ~1.5 MB of items: DynamoDB returns at least two pages
    for (let start = 0; start < total; start += 25) {
      const items = Array.from(
        { length: Math.min(25, total - start) },
        (_, i) => {
          const n = start + i;
          const id = `00000000-0000-4000-8000-${String(n + 1000).padStart(12, "0")}`;
          const sk = `2026-11-10T00:00:00.${String(n % 1000).padStart(3, "0")}Z#${id}`;
          return {
            PutRequest: {
              Item: {
                PK: "BRESET#TEAM#team-big",
                SK: sk,
                gsi1pk: `BRESETS#IDENT#${OID}`,
                gsi1sk: sk,
                oid: OID,
                amount: 1,
                pad,
              },
            },
          };
        },
      );
      await testDoc().send(
        new BatchWriteCommand({ RequestItems: { [TEST_TABLE_NAME]: items } }),
      );
    }
    const rows = await listTeamResets("team-big", "2026-11-10", "2026-11-10");
    expect(rows).toHaveLength(total);
    expect(await listResetsOf(OID, "2026-11-10", "2026-11-10")).toHaveLength(
      total,
    );
  });
});
