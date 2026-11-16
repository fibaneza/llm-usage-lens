import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";

import { getDailyRollups, getRollupsByDate } from "@/lib/data/daily-rollups";

import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
  makeRollup,
  putRaw,
  stripDate,
} from "@/test/support/test-support";

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

  // Spec change (audit A2, adopted 2026-10-28): the rollup now carries `date`.
  // Source: docs/specs/2026-05-15-data-model.md — "`date` attribute".
  it("returns parsed domain objects with date but no key attributes", async () => {
    const [first] = await getDailyRollups(
      acct.accountId,
      "2026-10-10",
      "2026-10-10",
    );
    expect(first).toEqual(makeRollup(acct, "2026-10-10", { cost: 10 }));
    expect(first?.date).toBe("2026-10-10");
    expect(first).not.toHaveProperty("PK");
    expect(first).not.toHaveProperty("SK");
    expect(first).not.toHaveProperty("gsi1pk");
    expect(first).not.toHaveProperty("gsi1sk");
  });

  it("returns date on every rollup in the range", async () => {
    const result = await getDailyRollups(
      acct.accountId,
      "2026-10-09",
      "2026-10-13",
    );
    expect(result.map((r) => r.date)).toEqual(DAYS);
  });

  it("derives date from SK for an item stored without it (no backfill needed)", async () => {
    const legacy = acct;
    await putRaw({
      ...stripDate(makeRollup(legacy, "2026-10-25", { cost: 25 })),
      PK: `ACCT#${legacy.accountId}`,
      SK: "DAILY#2026-10-25",
      gsi1pk: "DATE#2026-10-25",
      gsi1sk: `ACCT#${legacy.accountId}`,
    });
    const [rollup] = await getDailyRollups(
      legacy.accountId,
      "2026-10-25",
      "2026-10-25",
    );
    expect(rollup?.date).toBe("2026-10-25");
    expect(rollup?.cost).toBe(25);
    expect(rollup).not.toHaveProperty("SK");
  });

  it("returns nonModel unchanged for an item that carries it", async () => {
    const nonModel = {
      guardrails: {
        cost: 0.5,
        costEstimated: false,
        recurring: false,
        usageQuantity: 1200,
        usageUnit: "TextUnits",
        rawUsageTypes: ["USE1-Guardrail-ContentPolicy-Units"],
      },
      "provisioned-throughput": {
        cost: 24,
        costEstimated: false,
        recurring: true,
        rawUsageTypes: ["USE1-ProvisionedThroughput-ModelUnit"],
      },
    };
    const base = makeRollup(acct, "2026-10-26", { cost: 10 });
    await loadFixtures({
      rollups: [{ ...base, cost: 10 + 0.5 + 24, nonModel }],
    });
    const [rollup] = await getDailyRollups(
      acct.accountId,
      "2026-10-26",
      "2026-10-26",
    );
    expect(rollup?.nonModel).toEqual(nonModel);
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

  it("returns date on every rollup for the day", async () => {
    await loadFixtures({
      rollups: [
        makeRollup(acct, "2026-10-11", { cost: 1 }),
        makeRollup(other, "2026-10-11", { cost: 2 }),
      ],
    });
    const result = await getRollupsByDate("2026-10-11");
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.date === "2026-10-11")).toBe(true);
    for (const r of result) {
      expect(r).not.toHaveProperty("PK");
      expect(r).not.toHaveProperty("SK");
      expect(r).not.toHaveProperty("gsi1pk");
      expect(r).not.toHaveProperty("gsi1sk");
    }
  });

  it("derives date from SK for an item stored without it", async () => {
    await putRaw({
      ...stripDate(makeRollup(other, "2026-10-24", { cost: 7 })),
      PK: `ACCT#${other.accountId}`,
      SK: "DAILY#2026-10-24",
      gsi1pk: "DATE#2026-10-24",
      gsi1sk: `ACCT#${other.accountId}`,
    });
    const [rollup] = await getRollupsByDate("2026-10-24");
    expect(rollup?.date).toBe("2026-10-24");
    expect(rollup?.cost).toBe(7);
  });

  it("returns nonModel unchanged", async () => {
    const nonModel = {
      guardrails: {
        cost: 0.5,
        costEstimated: true,
        recurring: false,
        rawUsageTypes: ["USE1-Guardrail-ContentPolicy-Units"],
      },
    };
    const base = makeRollup(acct, "2026-10-23", { cost: 10 });
    await loadFixtures({
      rollups: [{ ...base, cost: 10.5, nonModel }],
    });
    const [rollup] = await getRollupsByDate("2026-10-23");
    expect(rollup?.nonModel).toEqual(nonModel);
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

// Source: docs/specs/2026-05-15-data-model.md — "`date` attribute": data-access
// functions return `date` on EVERY rollup, so the read type carries a required
// string `date`; Rule 60.17 (no silent failures — never an undated rollup).
describe("dated read type", () => {
  it("types date as a required string on both read functions", () => {
    expectTypeOf<
      Awaited<ReturnType<typeof getDailyRollups>>[number]["date"]
    >().toEqualTypeOf<string>();
    expectTypeOf<
      Awaited<ReturnType<typeof getRollupsByDate>>[number]["date"]
    >().toEqualTypeOf<string>();
  });

  it("getDailyRollups rejects an item with no date and an SK carrying no valid day", async () => {
    await putRaw({
      ...stripDate(makeRollup(acct, "2026-10-20")),
      PK: `ACCT#${acct.accountId}`,
      SK: "DAILY#2026-10-2x",
    });
    await expect(
      getDailyRollups(acct.accountId, "2026-10-20", "2026-10-30"),
    ).rejects.toThrow();
  });

  it("getRollupsByDate rejects an item with no date and an SK with no DAILY# day", async () => {
    await putRaw({
      ...stripDate(makeRollup(acct, "2026-10-22")),
      PK: `ACCT#${acct.accountId}`,
      SK: "LEGACY#unknown",
      gsi1pk: "DATE#2026-10-22",
      gsi1sk: `ACCT#${acct.accountId}`,
    });
    await expect(getRollupsByDate("2026-10-22")).rejects.toThrow();
  });
});

// Source: docs/specs/2026-05-15-data-model.md — "`date` attribute": a stored
// `date` that disagrees with the day in SK fails the read; it never silently
// picks one of the two days (Rule 60.17).
describe("stored date vs SK day", () => {
  it("getDailyRollups rejects when a stored date disagrees with the SK day", async () => {
    await putRaw({
      ...makeRollup(acct, "2026-10-11", { cost: 11 }),
      PK: `ACCT#${acct.accountId}`,
      SK: "DAILY#2026-10-10",
      gsi1pk: "DATE#2026-10-10",
      gsi1sk: `ACCT#${acct.accountId}`,
    });
    await expect(
      getDailyRollups(acct.accountId, "2026-10-09", "2026-10-12"),
    ).rejects.toThrow();
  });

  it("getRollupsByDate rejects when a stored date disagrees with the SK day", async () => {
    await putRaw({
      ...makeRollup(acct, "2026-10-11", { cost: 11 }),
      PK: `ACCT#${acct.accountId}`,
      SK: "DAILY#2026-10-10",
      gsi1pk: "DATE#2026-10-10",
      gsi1sk: `ACCT#${acct.accountId}`,
    });
    await expect(getRollupsByDate("2026-10-10")).rejects.toThrow();
  });

  it("getDailyRollups returns normally when the stored date equals the SK day", async () => {
    await putRaw({
      ...makeRollup(acct, "2026-10-10", { cost: 10 }),
      PK: `ACCT#${acct.accountId}`,
      SK: "DAILY#2026-10-10",
      gsi1pk: "DATE#2026-10-10",
      gsi1sk: `ACCT#${acct.accountId}`,
    });
    const result = await getDailyRollups(
      acct.accountId,
      "2026-10-09",
      "2026-10-12",
    );
    expect(result.map((r) => r.date)).toEqual(["2026-10-10"]);
  });

  it("getRollupsByDate returns normally when the stored date equals the SK day", async () => {
    await putRaw({
      ...makeRollup(acct, "2026-10-10", { cost: 10 }),
      PK: `ACCT#${acct.accountId}`,
      SK: "DAILY#2026-10-10",
      gsi1pk: "DATE#2026-10-10",
      gsi1sk: `ACCT#${acct.accountId}`,
    });
    const result = await getRollupsByDate("2026-10-10");
    expect(result.map((r) => r.date)).toEqual(["2026-10-10"]);
  });
});
