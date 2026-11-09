// Test-only builder for DatedDailyRollup fixtures with explicit per-model,
// per-user/service and non-model content. Not imported by production code.
import type {
  AttributionEntry,
  DatedDailyRollup,
  ModelKey,
  NonModelCategory,
} from "@llm-usage-lens/shared";

const acct = (n: number) => String(n).padStart(12, "0");

export type ModelSpec = {
  cost: number;
  inputTokens?: number;
  outputTokens?: number;
  invocations?: number;
  byUser?: Record<string, number>;
  byService?: Record<string, number>;
};

export type RollupSpec = {
  date: string;
  accountId?: string;
  departmentId?: string;
  departmentName?: string;
  teamId?: string;
  teamName?: string;
  models?: Partial<Record<ModelKey, ModelSpec>>;
  nonModel?: Partial<
    Record<NonModelCategory, { cost: number; recurring: boolean }>
  >;
};

const entry = (cost: number): AttributionEntry => ({
  cost,
  costEstimated: true,
  inputTokens: 100,
  outputTokens: 50,
  invocations: 1,
});

export function buildRollup(spec: RollupSpec): DatedDailyRollup {
  const models: DatedDailyRollup["models"] = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let invocations = 0;
  let cost = 0;
  for (const [key, m] of Object.entries(spec.models ?? {}) as [
    ModelKey,
    ModelSpec,
  ][]) {
    const input = m.inputTokens ?? 1000;
    const output = m.outputTokens ?? 500;
    const calls = m.invocations ?? 2;
    models[key] = {
      cost: m.cost,
      costEstimated: false,
      inputTokens: input,
      outputTokens: output,
      invocations: calls,
      byUser: Object.fromEntries(
        Object.entries(m.byUser ?? {}).map(([u, c]) => [u, entry(c)]),
      ),
      byService: Object.fromEntries(
        Object.entries(m.byService ?? {}).map(([s, c]) => [s, entry(c)]),
      ),
    };
    inputTokens += input;
    outputTokens += output;
    invocations += calls;
    cost += m.cost;
  }
  let nonModel: DatedDailyRollup["nonModel"];
  if (spec.nonModel) {
    nonModel = {};
    for (const [category, charge] of Object.entries(spec.nonModel) as [
      NonModelCategory,
      { cost: number; recurring: boolean },
    ][]) {
      nonModel[category] = {
        cost: charge.cost,
        costEstimated: false,
        recurring: charge.recurring,
        rawUsageTypes: ["USE1-Example"],
      };
      cost += charge.cost;
    }
  }
  return {
    date: spec.date,
    accountId: spec.accountId ?? acct(1),
    departmentId: spec.departmentId ?? "dept-engineering",
    departmentName: spec.departmentName ?? "Engineering",
    teamId: spec.teamId ?? "team-payments",
    teamName: spec.teamName ?? "Payments",
    cost,
    costFinalized: true,
    inputTokens,
    outputTokens,
    invocations,
    models,
    ...(nonModel ? { nonModel } : {}),
    lastUpdatedAt: `${spec.date}T13:00:00.000Z`,
    ttl: 1_900_000_000,
  };
}
