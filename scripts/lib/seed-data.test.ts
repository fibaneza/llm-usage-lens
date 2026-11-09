import {
  AccountMetaSchema,
  COLLECTOR_REGION,
  DailyRollupSchema,
  MODEL_KEYS,
  NON_MODEL_CATEGORIES,
  SyncStatusSchema,
} from "@llm-usage-lens/shared";
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
    expect(seed.accounts).toHaveLength(5);
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

  // Cost invariant (data-model spec, "Non-Model Charges"): cost is Σ models +
  // Σ nonModel; token and invocation totals stay model-only.
  it("keeps rollup totals equal to the sum of its models and non-model charges", () => {
    for (const r of rollups) {
      const usages = Object.values(r.models);
      const sum = (f: (u: (typeof usages)[number]) => number) =>
        usages.reduce((acc, u) => acc + f(u), 0);
      const nonModelCost = Object.values(r.nonModel ?? {}).reduce(
        (acc, charge) => acc + charge.cost,
        0,
      );
      expect(
        Math.abs(r.cost - (sum((u) => u.cost) + nonModelCost)),
      ).toBeLessThan(1e-6);
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

// Source: docs/specs/2026-05-15-implementation-phases.md — Phase 3.1a "Seed
// coverage"; docs/specs/2026-05-15-data-model.md — "Non-Model Charges" and
// "`date` attribute" (adopted 2026-10-28).
describe("buildSeedData — non-model coverage (default profile)", () => {
  const seed = buildSeedData("default", NOW);
  const rollups = rollupsOf(seed);
  const allDays = new Set(rollups.map((r) => r.date));

  it("every rollup carries a valid UTC date and passes the refined DailyRollupSchema", () => {
    for (const r of rollups) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const parsed = DailyRollupSchema.safeParse(r);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.date).toBe(r.date);
    }
  });

  it("only uses canonical nonModel category keys", () => {
    for (const r of rollups) {
      for (const key of Object.keys(r.nonModel ?? {})) {
        expect(NON_MODEL_CATEGORIES as readonly string[]).toContain(key);
      }
    }
  });

  it("includes guardrails charges on some, but not all, days", () => {
    const guardrailDays = new Set(
      rollups.filter((r) => r.nonModel?.guardrails).map((r) => r.date),
    );
    expect(guardrailDays.size).toBeGreaterThan(0);
    expect(guardrailDays.size).toBeLessThan(allDays.size);
    for (const r of rollups) {
      const g = r.nonModel?.guardrails;
      if (g) expect(g.recurring).toBe(false);
    }
  });

  const ptByAccount = () => {
    const map = new Map<string, SeedRollup[]>();
    for (const r of rollups) {
      if (r.nonModel?.["provisioned-throughput"]) {
        map.set(r.accountId, [...(map.get(r.accountId) ?? []), r]);
      }
    }
    return map;
  };

  it("has one account with Provisioned Throughput accruing every day (recurring)", () => {
    const expected = utcDaysEndingAt(NOW, 30);
    const full = [...ptByAccount().values()].filter(
      (rs) => rs.length === expected.length,
    );
    expect(full.length).toBeGreaterThanOrEqual(1);
    for (const rs of full) {
      expect(rs.map((r) => r.date).sort()).toEqual(expected);
      for (const r of rs) {
        expect(r.nonModel?.["provisioned-throughput"]?.recurring).toBe(true);
        expect(r.nonModel?.["provisioned-throughput"]?.cost).toBeGreaterThan(0);
      }
    }
  });

  it("includes an idle recurring day: PT-only, models {}, zero tokens, still valid", () => {
    const idle = [...ptByAccount().values()]
      .flat()
      .filter((r) => r.invocations === 0);
    expect(idle.length).toBeGreaterThanOrEqual(1);
    for (const r of idle) {
      expect(r.models).toEqual({});
      expect(r.inputTokens).toBe(0);
      expect(r.outputTokens).toBe(0);
      expect(r.cost).toBeGreaterThan(0);
      expect(r.nonModel?.["provisioned-throughput"]?.recurring).toBe(true);
      expect(DailyRollupSchema.safeParse(r).success).toBe(true);
    }
  });

  it("includes an unclassified entry with non-empty rawUsageTypes", () => {
    const entries = rollups
      .map((r) => r.nonModel?.unclassified)
      .filter((e) => e !== undefined);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of entries) {
      expect(entry.rawUsageTypes.length).toBeGreaterThan(0);
      for (const type of entry.rawUsageTypes)
        expect(type.length).toBeGreaterThan(0);
    }
  });

  it("keeps non-model charges off the model breakdown (no token fields on nonModel)", () => {
    for (const r of rollups) {
      for (const charge of Object.values(r.nonModel ?? {})) {
        expect(charge).not.toHaveProperty("inputTokens");
        expect(charge).not.toHaveProperty("invocations");
      }
    }
  });
});

// Source: docs/specs/2026-05-15-data-model.md — "Non-Model Charges" (Rules 1,
// 4, backward compatibility); Rule 20.3 (exact totals), Rule 20.12.
describe("buildSeedData — non-model separation (default profile)", () => {
  const rollups = rollupsOf(buildSeedData("default", NOW));
  const modelSum = (r: SeedRollup) =>
    Object.values(r.models).reduce((acc, u) => acc + u.cost, 0);
  const nonModelSum = (r: SeedRollup) =>
    Object.values(r.nonModel ?? {}).reduce((acc, c) => acc + c.cost, 0);

  it("omits the nonModel key entirely (not {}) on a rollup with no non-model charges", () => {
    const plain = rollups.filter((r) => nonModelSum(r) === 0);
    expect(plain.length).toBeGreaterThan(0);
    for (const r of plain) expect(r).not.toHaveProperty("nonModel");
    for (const r of rollups) {
      if ("nonModel" in r) {
        expect(Object.keys(r.nonModel ?? {}).length).toBeGreaterThan(0);
      }
    }
  });

  it("never folds non-model cost into a model: idle PT days have models {}", () => {
    const idle = rollups.filter(
      (r) => r.nonModel?.["provisioned-throughput"] && r.invocations === 0,
    );
    expect(idle.length).toBeGreaterThan(0);
    for (const r of idle) {
      expect(r.models).toEqual({});
      expect(r.cost).toBeCloseTo(nonModelSum(r), 6);
    }
  });

  it("never folds non-model cost into a model: on PT days with invocations, cost - Σ models = Σ nonModel", () => {
    const busy = rollups.filter(
      (r) => r.nonModel?.["provisioned-throughput"] && r.invocations > 0,
    );
    expect(busy.length).toBeGreaterThan(0);
    for (const r of busy) {
      expect(modelSum(r)).toBeLessThan(r.cost);
      expect(Math.abs(r.cost - modelSum(r) - nonModelSum(r))).toBeLessThan(
        1e-6,
      );
    }
  });
});

describe("buildSeedData — date on every profile", () => {
  it.each(["large", "ranking"] as const)(
    "%s profile rollups all carry date and pass DailyRollupSchema",
    (profile) => {
      const rollups = rollupsOf(buildSeedData(profile, NOW));
      expect(rollups.length).toBeGreaterThan(0);
      for (const r of rollups) {
        expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(DailyRollupSchema.safeParse(r).success).toBe(true);
      }
    },
  );
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

  // Source: docs/specs/2026-05-15-implementation-phases.md — Phase 3.2
  // ("large" profile: 20 users per team, 15 services).
  it("has 20 distinct users per team across the rollups", () => {
    const usersByTeam = new Map<string, Set<string>>();
    for (const r of rollupsOf(seed)) {
      const users = usersByTeam.get(r.teamId) ?? new Set<string>();
      for (const usage of Object.values(r.models)) {
        Object.keys(usage.byUser).forEach((u) => users.add(u));
      }
      usersByTeam.set(r.teamId, users);
    }
    expect(usersByTeam.size).toBe(
      new Set(seed.accounts.map((a) => a.teamId)).size,
    );
    for (const [, users] of usersByTeam) {
      expect(users.size).toBe(20);
    }
  });

  it("has exactly 15 distinct named services overall (excluding _untagged)", () => {
    const services = new Set<string>();
    for (const r of rollupsOf(seed)) {
      for (const usage of Object.values(r.models)) {
        Object.keys(usage.byService).forEach((s) => services.add(s));
      }
    }
    expect([...services].filter((s) => s !== "_untagged")).toHaveLength(15);
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

// Source: docs/specs/2026-05-15-implementation-phases.md — Phase 3.2 "Create
// seed scripts" / "Remap seed profiles to one account per team"; System
// Architecture — Organizational Hierarchy (Team = 1 AWS member account).
describe("buildSeedData — one account per team", () => {
  const TEAM_SLUGS_FIRST_20 = [
    "payments",
    "platform",
    "ml-research",
    "analytics",
    "growth",
    "search",
    "support",
    "security",
    "billing",
    "mobile",
    "infra",
    "fraud",
    "content",
    "identity",
    "reporting",
    "ads",
    "logistics",
    "risk",
    "insights",
    "onboarding",
  ];

  const cases = [
    { profile: "default", accounts: 5, departments: [2, 2, 1] },
    { profile: "empty", accounts: 5, departments: [2, 2, 1] },
    { profile: "large", accounts: 50, departments: [10, 10, 10, 10, 10] },
    { profile: "ranking", accounts: 100, departments: [20, 20, 20, 20, 20] },
  ] as const;

  describe.each(cases)(
    "$profile profile",
    ({ profile, accounts, departments }) => {
      const seed = buildSeedData(profile, NOW);

      it(`has ${accounts} accounts and ${accounts} distinct teams`, () => {
        expect(seed.accounts).toHaveLength(accounts);
        expect(new Set(seed.accounts.map((a) => a.teamId)).size).toBe(accounts);
        expect(new Set(seed.accounts.map((a) => a.accountId)).size).toBe(
          accounts,
        );
      });

      it("puts every account in COLLECTOR_REGION (ap-southeast-2)", () => {
        for (const a of seed.accounts) {
          expect(a.region).toBe(COLLECTOR_REGION);
          expect(a.region).toBe("ap-southeast-2");
        }
      });

      it("maps every team to exactly one account", () => {
        const accountsByTeam = new Map<string, string[]>();
        for (const a of seed.accounts) {
          accountsByTeam.set(a.teamId, [
            ...(accountsByTeam.get(a.teamId) ?? []),
            a.accountId,
          ]);
        }
        for (const ids of accountsByTeam.values()) expect(ids).toHaveLength(1);
      });

      it("keeps each team within one department and one team name", () => {
        const byTeam = new Map<string, Set<string>>();
        const names = new Map<string, Set<string>>();
        for (const a of seed.accounts) {
          byTeam.set(
            a.teamId,
            (byTeam.get(a.teamId) ?? new Set()).add(a.departmentId),
          );
          names.set(
            a.teamId,
            (names.get(a.teamId) ?? new Set()).add(a.teamName),
          );
        }
        for (const set of byTeam.values()) expect(set.size).toBe(1);
        for (const set of names.values()) expect(set.size).toBe(1);
        const teamNames = seed.accounts.map((a) => a.teamName);
        expect(new Set(teamNames).size).toBe(accounts);
      });

      it(`splits teams across departments as ${departments.join("+")}`, () => {
        const perDept = new Map<string, number>();
        for (const a of seed.accounts) {
          perDept.set(a.departmentId, (perDept.get(a.departmentId) ?? 0) + 1);
        }
        expect([...perDept.values()].sort((x, y) => y - x)).toEqual(
          [...departments].sort((x, y) => y - x),
        );
        expect(perDept.size).toBe(departments.length);
      });

      it("gives the first 20 teams stable slugs from the named list", () => {
        const ids = seed.accounts.map((a) => a.teamId);
        // Team index follows department order, so ids appear in TEAM_NAMES order.
        expect(ids.slice(0, 20)).toEqual(
          TEAM_SLUGS_FIRST_20.slice(0, Math.min(20, accounts)).map(
            (slug) => `team-${slug}`,
          ),
        );
      });
    },
  );

  it("default profile: 5 teams (2+2+1) with 2 users per team and rollups for every account", () => {
    const seed = buildSeedData("default", NOW);
    const usersByTeam = new Map<string, Set<string>>();
    for (const r of rollupsOf(seed)) {
      const users = usersByTeam.get(r.teamId) ?? new Set<string>();
      for (const usage of Object.values(r.models)) {
        Object.keys(usage.byUser).forEach((u) => users.add(u));
      }
      usersByTeam.set(r.teamId, users);
    }
    expect(usersByTeam.size).toBe(5);
    for (const users of usersByTeam.values()) expect(users.size).toBe(2);
    expect(seed.rollups).toHaveLength(5 * 30);
    expect(seed.syncStatus?.accountsTotal).toBe(5);
  });

  it("large and ranking: each rollup's team matches its account's team", () => {
    for (const profile of ["large", "ranking"] as const) {
      const seed = buildSeedData(profile, NOW);
      const teamByAccount = new Map(
        seed.accounts.map((a) => [a.accountId, a.teamId]),
      );
      for (const r of seed.rollups) {
        expect(r.teamId).toBe(teamByAccount.get(r.accountId));
      }
    }
  });

  it("empty profile mirrors the default profile's accounts", () => {
    expect(buildSeedData("empty", NOW).accounts).toEqual(
      buildSeedData("default", NOW).accounts,
    );
  });
});
