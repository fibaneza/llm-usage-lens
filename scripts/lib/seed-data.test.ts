import {
  AccountMetaSchema,
  DailyRollupSchema,
  MODEL_KEYS,
  SyncStatusSchema,
} from "@bedrock-usage/shared";
import { describe, expect, it } from "vitest";

import { buildSeedData } from "./seed-data";

// Source: docs/specs/2026-05-15-implementation-phases.md — Phase 3.2 seed
// scripts; docs/specs/2026-05-15-data-model.md — DailyRollup; Rule 20.
// Assumption: each generated rollup carries a `date` (UTC "YYYY-MM-DD") so the
// writer can derive the DAILY#/DATE# keys (the DailyRollup domain type has none).

const NOW = new Date("2026-10-23T00:30:00Z");
const NOW_LATE = new Date("2026-10-23T23:59:30Z");
const TODAY = "2026-10-23";

type Seed = ReturnType<typeof buildSeedData>;
type SeedRollup = Seed["rollups"][number] & { date: string };

function rollupsOf(seed: Seed): SeedRollup[] {
  return seed.rollups as SeedRollup[];
}

function utcDaysEndingAt(now: Date, count: number): string[] {
  const end = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Array.from({ length: count }, (_, i) =>
    new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

function daysByAccount(seed: Seed): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of rollupsOf(seed)) {
    map.set(r.accountId, [...(map.get(r.accountId) ?? []), r.date]);
  }
  return map;
}

describe("buildSeedData — default profile", () => {
  const seed = buildSeedData("default", NOW);
  const rollups = rollupsOf(seed);

  it("generates accounts that all satisfy AccountMetaSchema", () => {
    expect(seed.accounts.length).toBeGreaterThanOrEqual(5);
    for (const account of seed.accounts) {
      expect(AccountMetaSchema.safeParse(account).success).toBe(true);
    }
    const ids = seed.accounts.map((a) => a.accountId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("generates rollups that all satisfy DailyRollupSchema", () => {
    expect(rollups.length).toBeGreaterThan(0);
    for (const rollup of rollups) {
      expect(DailyRollupSchema.safeParse(rollup).success).toBe(true);
    }
  });

  it("has 3 departments and 5 teams", () => {
    expect(new Set(seed.accounts.map((a) => a.departmentId)).size).toBe(3);
    expect(new Set(seed.accounts.map((a) => a.teamId)).size).toBe(5);
  });

  it("has 10 users and 8 named services across the rollups", () => {
    const users = new Set<string>();
    const services = new Set<string>();
    for (const r of rollups) {
      for (const usage of Object.values(r.models)) {
        Object.keys(usage.byUser).forEach((u) => users.add(u));
        Object.keys(usage.byService).forEach((s) => services.add(s));
      }
    }
    expect(users.size).toBe(10);
    const named = [...services].filter((s) => s !== "_untagged");
    expect(named).toHaveLength(8);
  });

  it("covers multiple models, all canonical keys", () => {
    const used = new Set<string>();
    for (const r of rollups) Object.keys(r.models).forEach((m) => used.add(m));
    expect(used.size).toBeGreaterThan(1);
    for (const key of used) {
      expect(MODEL_KEYS as readonly string[]).toContain(key);
    }
  });

  it("has 30 consecutive UTC days per account ending at now's UTC date", () => {
    const expected = utcDaysEndingAt(NOW, 30);
    expect(expected.at(-1)).toBe(TODAY);
    for (const [, days] of daysByAccount(seed)) {
      expect([...days].sort()).toEqual(expected);
    }
    expect(daysByAccount(seed).size).toBe(seed.accounts.length);
  });

  it("buckets days by UTC even late in the UTC day", () => {
    const late = buildSeedData("default", NOW_LATE);
    const expected = utcDaysEndingAt(NOW_LATE, 30);
    for (const [, days] of daysByAccount(late)) {
      expect([...days].sort()).toEqual(expected);
    }
  });

  it("marks only today's rollup as not finalized (Rule 20.3)", () => {
    for (const r of rollups) {
      expect(r.costFinalized).toBe(r.date !== TODAY);
    }
    expect(rollups.some((r) => r.date === TODAY)).toBe(true);
  });

  it("flags every byUser/byService entry costEstimated (Rule 20.3)", () => {
    for (const r of rollups) {
      for (const usage of Object.values(r.models)) {
        for (const e of [
          ...Object.values(usage.byUser),
          ...Object.values(usage.byService),
        ]) {
          expect(e.costEstimated).toBe(true);
        }
      }
    }
  });

  it("keeps rollup totals equal to the sum of its models", () => {
    for (const r of rollups) {
      const usages = Object.values(r.models);
      const sum = (f: (u: (typeof usages)[number]) => number) =>
        usages.reduce((acc, u) => acc + f(u), 0);
      expect(Math.abs(r.cost - sum((u) => u.cost))).toBeLessThan(1e-6);
      expect(r.inputTokens).toBe(sum((u) => u.inputTokens));
      expect(r.outputTokens).toBe(sum((u) => u.outputTokens));
      expect(r.invocations).toBe(sum((u) => u.invocations));
    }
  });

  it("includes at least one _untagged service entry (Rule 20.10)", () => {
    const hasUntagged = rollups.some((r) =>
      Object.values(r.models).some((u) => "_untagged" in u.byService),
    );
    expect(hasUntagged).toBe(true);
  });

  it("sets ttl (epoch seconds) after lastUpdatedAt", () => {
    for (const r of rollups) {
      expect(r.ttl).toBeGreaterThan(Date.parse(r.lastUpdatedAt) / 1000);
    }
  });

  it("includes a valid SyncStatus", () => {
    expect(seed.syncStatus).not.toBeNull();
    expect(SyncStatusSchema.safeParse(seed.syncStatus).success).toBe(true);
  });

  it("is deterministic for the same now and shifts with a different now", () => {
    expect(buildSeedData("default", NOW)).toEqual(seed);
    const later = buildSeedData("default", new Date("2026-10-25T12:00:00Z"));
    expect(rollupsOf(later).some((r) => r.date === "2026-10-25")).toBe(true);
  });
});

describe("buildSeedData — empty profile", () => {
  const seed = buildSeedData("empty", NOW);

  it("has valid accounts but no rollups and no sync status (never synced)", () => {
    expect(seed.accounts.length).toBeGreaterThan(0);
    for (const account of seed.accounts) {
      expect(AccountMetaSchema.safeParse(account).success).toBe(true);
    }
    expect(seed.rollups).toEqual([]);
    expect(seed.syncStatus).toBeNull();
  });
});

describe("buildSeedData — large profile", () => {
  const seed = buildSeedData("large", NOW);

  it("has 50 accounts with 90 UTC days each", () => {
    expect(seed.accounts).toHaveLength(50);
    const expected = utcDaysEndingAt(NOW, 90);
    const byAccount = daysByAccount(seed);
    expect(byAccount.size).toBe(50);
    for (const [, days] of byAccount) {
      expect([...days].sort()).toEqual(expected);
    }
  });

  it("generates schema-valid rollups", () => {
    expect(seed.rollups).toHaveLength(50 * 90);
    for (const r of seed.rollups) {
      expect(DailyRollupSchema.safeParse(r).success).toBe(true);
    }
  });
});

describe("buildSeedData — ranking profile", () => {
  const seed = buildSeedData("ranking", NOW);

  it("has 100 accounts with 30 UTC days each", () => {
    expect(seed.accounts).toHaveLength(100);
    const expected = utcDaysEndingAt(NOW, 30);
    const byAccount = daysByAccount(seed);
    expect(byAccount.size).toBe(100);
    for (const [, days] of byAccount) {
      expect([...days].sort()).toEqual(expected);
    }
    expect(seed.rollups).toHaveLength(100 * 30);
  });

  it("generates schema-valid accounts", () => {
    for (const a of seed.accounts) {
      expect(AccountMetaSchema.safeParse(a).success).toBe(true);
    }
  });
});
