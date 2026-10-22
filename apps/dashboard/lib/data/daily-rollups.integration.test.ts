import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDailyRollups, getRollupsByDate } from "@/lib/data/daily-rollups";

import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
  makeRollup,
  putRaw,
  stripDate,
} from "./test-support";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: DailyRollup" access
// patterns + "Query Pagination"; Rules 20.1 (UTC days), 20.6, 60.17.
const acct = makeAccount(1);
const other = makeAccount(2);

const DAYS = [
  "2026-10-09",
  "2026-10-10",
  "2026-10-11",
  "2026-10-12",
  "2026-10-13",
];

beforeAll(ensureTestTable);
beforeEach(clearTable);

describe("getDailyRollups", () => {
  beforeEach(async () => {
    await loadFixtures({
      accounts: [acct, other],
      // Insert out of order; cost encodes the day-of-month for order checks.
      rollups: [
        ...[...DAYS]
          .reverse()
          .map((d) => makeRollup(acct, d, { cost: Number(d.slice(-2)) })),
        makeRollup(other, "2026-10-11", { cost: 999 }),
      ],
    });
  });

  it("includes both range boundaries and returns days ascending", async () => {
    const result = await getDailyRollups(
      acct.accountId,
      "2026-10-10",
      "2026-10-12",
    );
    expect(result.map((r) => r.cost)).toEqual([10, 11, 12]);
  });

  it("returns parsed domain objects with no key attributes or date", async () => {
    const [first] = await getDailyRollups(
      acct.accountId,
      "2026-10-10",
      "2026-10-10",
    );
    expect(first).toEqual(
      stripDate(makeRollup(acct, "2026-10-10", { cost: 10 })),
    );
    expect(first).not.toHaveProperty("PK");
    expect(first).not.toHaveProperty("SK");
    expect(first).not.toHaveProperty("gsi1pk");
  });

  it("supports a single-day range", async () => {
    const result = await getDailyRollups(
      acct.accountId,
      "2026-10-13",
      "2026-10-13",
    );
    expect(result.map((r) => r.cost)).toEqual([13]);
  });

  it("excludes other accounts", async () => {
    const result = await getDailyRollups(
      acct.accountId,
      "2026-10-01",
      "2026-10-31",
    );
    expect(result).toHaveLength(DAYS.length);
    expect(result.every((r) => r.accountId === acct.accountId)).toBe(true);
  });

  it("returns [] for a range with no rollups", async () => {
    expect(
      await getDailyRollups(acct.accountId, "2026-01-01", "2026-01-31"),
    ).toEqual([]);
  });

  it("returns [] for an account with no rollups", async () => {
    expect(
      await getDailyRollups("999999999999", "2026-10-01", "2026-10-31"),
    ).toEqual([]);
  });

  it("rejects when a stored rollup fails the schema", async () => {
    await putRaw({
      PK: `ACCT#${acct.accountId}`,
      SK: "DAILY#2026-10-20",
      accountId: acct.accountId,
      cost: -5,
    });
    await expect(
      getDailyRollups(acct.accountId, "2026-10-20", "2026-10-20"),
    ).rejects.toThrow();
  });
});

describe("getRollupsByDate", () => {
  it("returns every account's rollup for that UTC day only", async () => {
    await loadFixtures({
      rollups: [
        makeRollup(acct, "2026-10-11", { cost: 1 }),
        makeRollup(other, "2026-10-11", { cost: 2 }),
        makeRollup(acct, "2026-10-12", { cost: 3 }),
      ],
    });
    const result = await getRollupsByDate("2026-10-11");
    expect(result.map((r) => r.cost).sort()).toEqual([1, 2]);
    expect(result.map((r) => r.accountId).sort()).toEqual([
      acct.accountId,
      other.accountId,
    ]);
  });

  it("returns [] when nothing was rolled up that day", async () => {
    expect(await getRollupsByDate("2026-01-01")).toEqual([]);
  });

  it("loops on LastEvaluatedKey so results beyond 1MB are all returned (Rule 20.6)", async () => {
    const accounts = Array.from({ length: 35 }, (_, i) => makeAccount(200 + i));
    const rollups = accounts.map((a) =>
      makeRollup(a, "2026-10-11", { userCount: 450 }),
    );
    // Guard: the fixture must really exceed one 1MB GSI1 page.
    expect(JSON.stringify(rollups).length).toBeGreaterThan(1_100_000);

    await loadFixtures({ rollups });
    const result = await getRollupsByDate("2026-10-11");

    expect(result).toHaveLength(accounts.length);
    expect(new Set(result.map((r) => r.accountId))).toEqual(
      new Set(accounts.map((a) => a.accountId)),
    );
  });

  it("rejects when a stored rollup fails the schema", async () => {
    await putRaw({
      PK: "ACCT#000000000555",
      SK: "DAILY#2026-10-21",
      gsi1pk: "DATE#2026-10-21",
      gsi1sk: "ACCT#000000000555",
      accountId: "bad",
    });
    await expect(getRollupsByDate("2026-10-21")).rejects.toThrow();
  });
});
