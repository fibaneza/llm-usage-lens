import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { BudgetReset } from "@llm-usage-lens/shared";
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
  scope: "member" as const,
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

// A copy of an item without the named keys (builds the unlinked and no-team shapes).
const omitKeys = (
  obj: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

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

// Data Model - BudgetReset (amended 2026-11-19, RS2, D-RS8): two new PK forms
// under BRESET#; GSI1 only when an oid exists; an unlinked reset counts for
// nobody. Ledger key decision: temp/run-rs2/ledger-key.md (T-RS6).
describe("budgetResetPutItem for resets by LiteLLM id (RS2, D-RS8, T-RS6)", () => {
  const RID2 = "00000000-0000-4000-8000-000000000002";
  const memberNoApp = omitKeys(reset, ["oid", "teamId", "departmentId"]);
  const userReset = {
    scope: "user" as const,
    resetId: RID2,
    litellmUserId: "u9@company.com",
    operation: "spend" as const,
    amount: 7.5,
    budget: null as number | null,
    trigger: "direct" as const,
    actorOid: "00000000-0000-4000-8000-0000000000a1",
    requestId: "req-2",
    timestamp: TS,
  };
  const get = async (pk: string, resetId: string) =>
    (
      await testDoc().send(
        new GetCommand({
          TableName: TEST_TABLE_NAME,
          Key: { PK: pk, SK: `${TS}#${resetId}` },
        }),
      )
    ).Item;

  it("a member reset on an unlinked LiteLLM team, with no app identity, is keyed BRESET#LTEAM#{litellmTeamId} with no GSI1 attributes", async () => {
    await write(budgetResetPutItem(memberNoApp as BudgetReset));
    const item = await get("BRESET#LTEAM#lt-team-a", RESET_ID);
    expect(item).toMatchObject({
      scope: "member",
      litellmTeamId: "lt-team-a",
      litellmUserId: "a1@company.com",
      amount: 3.25,
      expiresAt: Date.parse(TS) / 1000 + 400 * 86_400,
    });
    expect(item).not.toHaveProperty("gsi1pk");
    expect(item).not.toHaveProperty("gsi1sk");
    expect(item).not.toHaveProperty("oid");
    expect(item).not.toHaveProperty("teamId");
    expect(item).not.toHaveProperty("departmentId");
    expect(await get("BRESET#TEAM#team-a", RESET_ID)).toBeUndefined();
  });

  it("a member reset on an unlinked team for a linked person (oid, no teamId) is keyed BRESET#LTEAM# and still has the person's GSI1 item", async () => {
    const noTeam = omitKeys(reset, ["teamId", "departmentId"]);
    await write(budgetResetPutItem(noTeam as BudgetReset));
    expect(await get("BRESET#LTEAM#lt-team-a", RESET_ID)).toMatchObject({
      gsi1pk: `BRESETS#IDENT#${OID}`,
      gsi1sk: `${TS}#${RESET_ID}`,
    });
    expect(await listResetsOf(OID, "2026-11-14", "2026-11-14")).toEqual([
      { oid: OID, amount: 3.25 },
    ]);
  });

  it("a user-scope reset with no oid is keyed BRESET#LUSER#{litellmUserId}, no GSI1, no litellmTeamId", async () => {
    await write(budgetResetPutItem(userReset));
    const item = await get("BRESET#LUSER#u9@company.com", RID2);
    expect(item).toMatchObject({
      scope: "user",
      litellmUserId: "u9@company.com",
      operation: "spend",
      amount: 7.5,
      trigger: "direct",
      expiresAt: Date.parse(TS) / 1000 + 400 * 86_400,
    });
    for (const k of ["gsi1pk", "gsi1sk", "oid", "teamId", "litellmTeamId"]) {
      expect(item, k).not.toHaveProperty(k);
    }
  });

  it("a user-scope reset of a linked person (oid) keeps BRESET#LUSER# and adds BRESETS#IDENT#{oid}", async () => {
    await write(budgetResetPutItem({ ...userReset, oid: OID }));
    expect(await get("BRESET#LUSER#u9@company.com", RID2)).toMatchObject({
      gsi1pk: `BRESETS#IDENT#${OID}`,
      gsi1sk: `${TS}#${RID2}`,
    });
    expect(await listResetsOf(OID, "2026-11-14", "2026-11-14")).toEqual([
      { oid: OID, amount: 7.5 },
    ]);
  });

  it("an unlinked reset counts for nobody: no per-team and no per-person read returns it (Data Model - Reset counts)", async () => {
    await write(budgetResetPutItem(memberNoApp as BudgetReset));
    await write(budgetResetPutItem(userReset));
    expect(await listTeamResets("team-a", "2026-11-14", "2026-11-14")).toEqual(
      [],
    );
    expect(await listResetsOf(OID, "2026-11-14", "2026-11-14")).toEqual([]);
    expect(await listResetsOf("anyone", "2026-11-14", "2026-11-14")).toEqual(
      [],
    );
  });

  it("the new forms stay append-only: a second Put of the same key fails and changes nothing", async () => {
    await write(budgetResetPutItem(userReset));
    await expect(
      write(budgetResetPutItem({ ...userReset, amount: 99 })),
    ).rejects.toThrow();
    expect((await get("BRESET#LUSER#u9@company.com", RID2))?.amount).toBe(7.5);
  });

  it.each([
    [
      "a user scope with the budget operation",
      { ...userReset, operation: "budget" },
    ],
    [
      "a user scope carrying a litellmTeamId",
      { ...userReset, litellmTeamId: "lt" },
    ],
    [
      "a user scope with no litellmUserId",
      { ...userReset, litellmUserId: undefined },
    ],
    ["an item with no scope", { ...reset, scope: undefined }],
    ["an empty oid", { ...userReset, oid: "" }],
  ])("refuses %s before anything is written", (_n, bad) => {
    expect(() => budgetResetPutItem(bad as unknown as BudgetReset)).toThrow();
  });

  it("existing oid-based member items still satisfy the ledger contract (T-RS6): BRESET#TEAM# + GSI1, counted per team and per person", async () => {
    await write(budgetResetPutItem(reset));
    expect((await get("BRESET#TEAM#team-a", RESET_ID))?.gsi1pk).toBe(
      `BRESETS#IDENT#${OID}`,
    );
    expect(await listTeamResets("team-a", "2026-11-14", "2026-11-14")).toEqual([
      { oid: OID, amount: 3.25 },
    ]);
  });

  it("the reader counts a pre-RS2 item that has no scope attribute as a member reset (Data Model, amended 2026-11-19)", async () => {
    const sk = `${TS}#${RESET_ID}`;
    await testDoc().send(
      new PutCommand({
        TableName: TEST_TABLE_NAME,
        Item: {
          PK: "BRESET#TEAM#team-a",
          SK: sk,
          gsi1pk: `BRESETS#IDENT#${OID}`,
          gsi1sk: sk,
          oid: OID,
          amount: 2,
        },
      }),
    );
    expect(await listTeamResets("team-a", "2026-11-14", "2026-11-14")).toEqual([
      { oid: OID, amount: 2 },
    ]);
    expect(await listResetsOf(OID, "2026-11-14", "2026-11-14")).toEqual([
      { oid: OID, amount: 2 },
    ]);
  });
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
