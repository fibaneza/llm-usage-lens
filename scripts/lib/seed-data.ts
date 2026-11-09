import { COLLECTOR_REGION, MODEL_KEYS } from "@llm-usage-lens/shared";
import type {
  AccountMeta,
  AttributionEntry,
  DailyRollupItem,
  ModelKey,
  ModelUsage,
  NonModelCategory,
  NonModelCharge,
  SyncStatus,
} from "@llm-usage-lens/shared";

// Source: docs/specs/2026-05-15-implementation-phases.md — Phase 3.2 seed
// scripts; docs/specs/2026-05-15-data-model.md — DailyRollup; Rule 20.
// Pure and deterministic: a seeded PRNG keyed by account + UTC day, no
// Math.random / Date.now, UTC-only day arithmetic (Rule 20.1).

export type SeedProfile = "default" | "empty" | "large" | "ranking";

// The write-side item minus its DynamoDB key attributes (added by the writer);
// `date` is required here, optional on the read-side DailyRollup.
export type SeedRollup = Omit<
  DailyRollupItem,
  "PK" | "SK" | "gsi1pk" | "gsi1sk"
>;

export type SeedData = {
  accounts: AccountMeta[];
  rollups: SeedRollup[];
  syncStatus: SyncStatus | null;
};

type ProfileConfig = {
  departments: number;
  teamsPerDepartment: readonly number[];
  days: number;
  usersPerTeam: number;
  services: number;
  withRollups: boolean;
  withSyncStatus: boolean;
  withNonModel: boolean;
};

// default: 3 departments / 5 teams (2+2+1) / 10 users (2 per team) / 8 services.
// One account per team: the account count is the sum of teamsPerDepartment.
const PROFILES: Record<SeedProfile, ProfileConfig> = {
  default: {
    departments: 3,
    teamsPerDepartment: [2, 2, 1],
    days: 30,
    usersPerTeam: 2,
    services: 8,
    withRollups: true,
    withSyncStatus: true,
    withNonModel: true,
  },
  empty: {
    departments: 3,
    teamsPerDepartment: [2, 2, 1],
    days: 0,
    usersPerTeam: 2,
    services: 8,
    withRollups: false,
    withSyncStatus: false,
    withNonModel: false,
  },
  large: {
    departments: 5,
    teamsPerDepartment: [10, 10, 10, 10, 10],
    days: 90,
    usersPerTeam: 20,
    services: 15,
    withRollups: true,
    withSyncStatus: true,
    withNonModel: false,
  },
  ranking: {
    departments: 5,
    teamsPerDepartment: [20, 20, 20, 20, 20],
    days: 30,
    usersPerTeam: 3,
    services: 8,
    withRollups: true,
    withSyncStatus: true,
    withNonModel: false,
  },
};

const DEPARTMENT_NAMES = [
  "Engineering",
  "Data Science",
  "Product",
  "Operations",
  "Finance",
];
const TEAM_NAMES = [
  "Payments",
  "Platform",
  "ML Research",
  "Analytics",
  "Growth",
  "Search",
  "Support",
  "Security",
  "Billing",
  "Mobile",
  "Infra",
  "Fraud",
  "Content",
  "Identity",
  "Reporting",
  "Ads",
  "Logistics",
  "Risk",
  "Insights",
  "Onboarding",
];
const SERVICE_NAMES = [
  "payments-api",
  "chat-assistant",
  "doc-summarizer",
  "code-review-bot",
  "search-ranker",
  "support-triage",
  "fraud-detector",
  "report-writer",
  "image-captioner",
  "email-drafter",
  "log-analyzer",
  "translation-svc",
  "meeting-notes",
  "sql-copilot",
  "onboarding-guide",
];

const UNTAGGED = "_untagged";
const DAY_MS = 86_400_000;
const TTL_SECONDS = 365 * 86_400;
const HOUR_MS = 3_600_000;
const COST_DECIMALS = 1e6;
const CREATED_AT = "2026-01-05T08:00:00.000Z";

// Illustrative on-demand USD per 1M tokens — seed realism only, not billing data.
const PRICE_PER_MTOK: Record<ModelKey, { input: number; output: number }> = {
  "claude-opus": { input: 15, output: 75 },
  "claude-sonnet": { input: 3, output: 15 },
  "claude-haiku": { input: 0.8, output: 4 },
  other: { input: 1, output: 3 },
};
const OTHER_RAW_MODEL_IDS = ["amazon.titan-text-express-v1", "meta.llama3-70b"];

// Non-model seed shapes (data-model spec, "Non-Model Charges"). The usage-type
// strings are illustrative placeholders, not verified AWS values.
const PT_DAILY_COST = 24;
const GUARDRAILS_RAW_USAGE_TYPES = ["SEED-PLACEHOLDER-Guardrail-Units"];
const PT_RAW_USAGE_TYPES = ["SEED-PLACEHOLDER-ProvisionedThroughput-ModelUnit"];
const UNCLASSIFIED_RAW_USAGE_TYPES = ["SEED-PLACEHOLDER-UnmappedBedrockUsage"];
const PT_ACCOUNT_INDEX = 0;
const UNCLASSIFIED_ACCOUNT_INDEX = 1;

function round6(value: number): number {
  return Math.round(value * COST_DECIMALS) / COST_DECIMALS;
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// mulberry32 — small seeded PRNG returning floats in [0, 1).
function createRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function utcMidnightMs(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function utcDays(now: Date, count: number): string[] {
  const end = utcMidnightMs(now);
  return Array.from({ length: count }, (_, i) =>
    new Date(end - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

// Largest-remainder split so the parts sum exactly to the integer total.
function splitInt(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / weightSum);
  const parts = raw.map(Math.floor);
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    remainder -= 1;
  }
  return parts;
}

// Proportional cost shares at 6 decimals; the last share absorbs rounding so
// the parts sum to the total.
function splitCost(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => round6((total * w) / weightSum));
  const lastIndex = parts.length - 1;
  const head = parts.slice(0, lastIndex).reduce((a, b) => a + b, 0);
  parts[lastIndex] = Math.max(0, round6(total - head));
  return parts;
}

// Attribute a model's usage across keys (users or services). Tokens and
// invocations split exactly; cost is a token-proportional estimate
// (Rule 20.3 — costEstimated is always true).
function attribute(
  keys: readonly string[],
  weights: readonly number[],
  usage: Pick<
    ModelUsage,
    "cost" | "inputTokens" | "outputTokens" | "invocations"
  >,
): Record<string, AttributionEntry> {
  const input = splitInt(usage.inputTokens, weights);
  const output = splitInt(usage.outputTokens, weights);
  const invocations = splitInt(usage.invocations, weights);
  const cost = splitCost(
    usage.cost,
    input.map((tokens, i) => tokens + (output[i] ?? 0) || 1),
  );
  const entries: Record<string, AttributionEntry> = {};
  keys.forEach((key, i) => {
    entries[key] = {
      cost: cost[i] ?? 0,
      costEstimated: true,
      inputTokens: input[i] ?? 0,
      outputTokens: output[i] ?? 0,
      invocations: invocations[i] ?? 0,
    };
  });
  return entries;
}

type Team = {
  departmentId: string;
  departmentName: string;
  teamId: string;
  teamName: string;
  users: string[];
  services: string[];
};

function buildTeams(config: ProfileConfig): Team[] {
  const teams: Team[] = [];
  const serviceNames = SERVICE_NAMES.slice(0, config.services);
  let teamIndex = 0;
  for (let d = 0; d < config.departments; d += 1) {
    const departmentName = DEPARTMENT_NAMES[d] ?? `Department ${d + 1}`;
    const count = config.teamsPerDepartment[d] ?? 0;
    for (let t = 0; t < count; t += 1) {
      const teamName = TEAM_NAMES[teamIndex] ?? `Team ${teamIndex + 1}`;
      const slug = teamName.toLowerCase().replace(/\s+/g, "-");
      const users = Array.from(
        { length: config.usersPerTeam },
        (_, u) => `${slug}-user${String(u + 1).padStart(2, "0")}@company.com`,
      );
      // Each team owns a rotating window of services; the union covers all.
      const perTeam = Math.min(4, serviceNames.length);
      const services = Array.from(
        { length: perTeam },
        (_, s) => serviceNames[(teamIndex * 2 + s) % serviceNames.length] ?? "",
      );
      teams.push({
        departmentId: `dept-${departmentName.toLowerCase().replace(/\s+/g, "-")}`,
        departmentName,
        teamId: `team-${slug}`,
        teamName,
        users,
        services,
      });
      teamIndex += 1;
    }
  }
  return teams;
}

type SeedAccount = {
  meta: AccountMeta;
  team: Team;
  scale: number;
  index: number;
};

function buildAccounts(config: ProfileConfig, teams: Team[]): SeedAccount[] {
  return teams.map((team, i) => {
    const accountId = String(i + 1).padStart(12, "0");
    const rng = createRng(hashSeed(`scale:${accountId}`));
    return {
      team,
      index: i,
      scale: 0.4 + rng() * 2.2,
      meta: {
        accountId,
        accountName: `${team.teamId.replace("team-", "")}-prod`,
        departmentId: team.departmentId,
        departmentName: team.departmentName,
        teamId: team.teamId,
        teamName: team.teamName,
        region: COLLECTOR_REGION,
        active: true,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    };
  });
}

// Non-model charges for one account-day: Guardrails on some days (never when
// dayIndex % 7 === 0), always-on Provisioned Throughput for one account, and a
// rare `unclassified` entry. Values are rounded so the day total can be summed
// from them exactly (Data Model — "Schema decisions").
function buildNonModel(
  account: SeedAccount,
  dayIndex: number,
  rng: () => number,
): Partial<Record<NonModelCategory, NonModelCharge>> {
  const nonModel: Partial<Record<NonModelCategory, NonModelCharge>> = {};
  if (dayIndex % 7 !== 0 && rng() < 0.25) {
    nonModel.guardrails = {
      cost: round6(0.2 + rng() * 2),
      costEstimated: false,
      recurring: false,
      rawUsageTypes: GUARDRAILS_RAW_USAGE_TYPES,
    };
  }
  if (account.index === PT_ACCOUNT_INDEX) {
    nonModel["provisioned-throughput"] = {
      cost: PT_DAILY_COST,
      costEstimated: false,
      recurring: true,
      rawUsageTypes: PT_RAW_USAGE_TYPES,
    };
  }
  if (account.index === UNCLASSIFIED_ACCOUNT_INDEX && dayIndex % 11 === 5) {
    nonModel.unclassified = {
      cost: round6(0.1 + rng() * 0.5),
      costEstimated: false,
      recurring: false,
      rawUsageTypes: UNCLASSIFIED_RAW_USAGE_TYPES,
    };
  }
  return nonModel;
}

// The Provisioned Throughput account has no invocations on these days, so its
// rollup is idle: models {} and cost = the non-model sum (Rule 20.12).
const isIdlePtDay = (account: SeedAccount, dayIndex: number): boolean =>
  account.index === PT_ACCOUNT_INDEX && dayIndex % 10 === 3;

function buildRollup(
  account: SeedAccount,
  date: string,
  dayIndex: number,
  isToday: boolean,
  now: Date,
  withNonModel: boolean,
): SeedRollup {
  const rng = createRng(hashSeed(`${account.meta.accountId}:${date}`));
  const finalized = !isToday;
  // Today is a partial day, so volume is scaled down.
  const dayFactor = isToday ? 0.4 : 1;
  const { team } = account;

  const idle = withNonModel && isIdlePtDay(account, dayIndex);
  const modelKeys = MODEL_KEYS.filter((key) => {
    if (idle) return false;
    if (key === "claude-sonnet") return true;
    if (key === "other") return rng() < 0.15;
    return rng() < 0.75;
  });

  const models: Partial<Record<ModelKey, ModelUsage>> = {};
  for (const key of modelKeys) {
    const invocations = Math.max(
      team.users.length * 2,
      Math.round((200 + rng() * 1800) * account.scale * dayFactor),
    );
    const inputTokens = invocations * Math.round(400 + rng() * 2600);
    const outputTokens = invocations * Math.round(150 + rng() * 900);
    const price = PRICE_PER_MTOK[key];
    const cost = round6(
      ((inputTokens * price.input + outputTokens * price.output) / 1e6) *
        (0.95 + rng() * 0.1),
    );
    const usage = { cost, inputTokens, outputTokens, invocations };

    const userWeights = team.users.map(() => 1 + rng() * 9);
    const serviceKeys = [...team.services, UNTAGGED];
    const serviceWeights = serviceKeys.map((k) =>
      k === UNTAGGED ? 0.5 + rng() * 2 : 1 + rng() * 9,
    );

    models[key] = {
      ...usage,
      costEstimated: !finalized,
      ...(key === "other" ? { rawModelIds: OTHER_RAW_MODEL_IDS } : {}),
      byUser: attribute(team.users, userWeights, usage),
      byService: attribute(serviceKeys, serviceWeights, usage),
    };
  }

  const nonModel = withNonModel ? buildNonModel(account, dayIndex, rng) : {};
  const nonModelCost = Object.values(nonModel).reduce(
    (acc, charge) => acc + charge.cost,
    0,
  );
  const usages = Object.values(models);
  const sum = (pick: (u: ModelUsage) => number) =>
    usages.reduce((acc, u) => acc + pick(u), 0);
  const lastUpdatedAt = isToday ? now.toISOString() : `${date}T23:59:59.000Z`;

  return {
    date,
    accountId: account.meta.accountId,
    departmentId: team.departmentId,
    departmentName: team.departmentName,
    teamId: team.teamId,
    teamName: team.teamName,
    // Sums already-rounded 6-dp entries (Data Model, Schema decisions), not a
    // separately rounded total.
    cost: round6(sum((u) => u.cost) + nonModelCost),
    costFinalized: finalized,
    inputTokens: sum((u) => u.inputTokens),
    outputTokens: sum((u) => u.outputTokens),
    invocations: sum((u) => u.invocations),
    models,
    ...(Object.keys(nonModel).length > 0 ? { nonModel } : {}),
    lastUpdatedAt,
    ttl: Math.floor(Date.parse(lastUpdatedAt) / 1000) + TTL_SECONDS,
  };
}

function buildSyncStatus(now: Date, accountsTotal: number): SyncStatus {
  const lastRun = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  return {
    lastRunAt: new Date(lastRun).toISOString(),
    nextScheduledAt: new Date(lastRun + HOUR_MS).toISOString(),
    status: "success",
    accountsTotal,
    accountsSuccess: accountsTotal,
    accountsFailed: 0,
    errors: [],
    durationMs: 42_000,
  };
}

export function buildSeedData(profile: SeedProfile, now: Date): SeedData {
  const config = PROFILES[profile];
  const accounts = buildAccounts(config, buildTeams(config));
  const days = config.withRollups ? utcDays(now, config.days) : [];
  const today = now.toISOString().slice(0, 10);

  const rollups = accounts.flatMap((account) =>
    days.map((date, dayIndex) =>
      buildRollup(
        account,
        date,
        dayIndex,
        date === today,
        now,
        config.withNonModel,
      ),
    ),
  );

  return {
    accounts: accounts.map((a) => a.meta),
    rollups,
    syncStatus: config.withSyncStatus
      ? buildSyncStatus(now, accounts.length)
      : null,
  };
}
