import "server-only";

import { MODEL_KEYS, canonicalUsageIdentity } from "@llm-usage-lens/shared";
import type {
  CombinedOrganisationFigure,
  CombinedPersonFigure,
  CombinedVisibility,
  DatedDailyRollup,
} from "@llm-usage-lens/shared";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Gateway configuration (Matching: exact only), The computation,
// Visibility, States; LD38; shared contract 5; Rule 20.3. Pure: no I/O. The
// loader (combined-data.ts) reads and calls it.

export const BEDROCK_PROVIDERS: readonly string[] = ["bedrock"];

export class CombinedInvariantError extends Error {
  constructor(detail: string) {
    super(`Combined usage invariant broken: ${detail}`);
    this.name = "CombinedInvariantError";
  }
}

export type Gateway = {
  principals: readonly { type: "iam-role" | "usage-key"; value: string }[];
  accountIds: readonly string[];
};

export type LiteLLMDailyRow = {
  date?: string;
  metrics?: { spend?: number };
  breakdown?: {
    providers?: Record<string, { metrics?: { spend?: number } }>;
  };
};

export type LiteLLMSide =
  | { kind: "rows"; rows: readonly LiteLLMDailyRow[] }
  | { kind: "not-configured" }
  | { kind: "not-linked" }
  | { kind: "no-user" };

const TOLERANCE = 1e-6;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const roundOrNull = (n: number | null): number | null =>
  n === null ? null : round6(n);

// ---- matching --------------------------------------------------------------

const ROLE_ARN =
  /^arn:aws:(?:sts::\d{12}:assumed-role\/([^/]+)\/[^/]+|iam::\d{12}:role\/(?:[^/]+\/)*([^/]+))$/;

export function gatewayMatcher(
  principals: Gateway["principals"],
): (rawByUserKey: string) => boolean {
  const roles = new Set<string>();
  const keys = new Set<string>();
  for (const p of principals) {
    const value = p.value.trim();
    if (p.type === "iam-role") roles.add(value.toLowerCase());
    else keys.add(value);
  }
  return (raw) => {
    if (keys.has(raw)) return true;
    if (roles.has(raw.toLowerCase())) return true;
    const match = ROLE_ARN.exec(raw);
    const name = match?.[1] ?? match?.[2];
    return name !== undefined && roles.has(name.toLowerCase());
  };
}

export const isGatewayConfigured = (gateway: Gateway): boolean =>
  gateway.principals.length > 0 || gateway.accountIds.length > 0;

export function combinedVisibility(
  globalReader: boolean,
  gatewayConfigured: boolean,
): CombinedVisibility {
  if (gatewayConfigured) return "show";
  return globalReader ? "warn" : "hidden";
}

// ---- Bedrock side ----------------------------------------------------------

type Split = { slice: number; direct: number; principalSplit: boolean };

function splitRollup(
  rollup: DatedDailyRollup,
  accounts: ReadonlySet<string>,
  matches: (key: string) => boolean,
): Split {
  if (accounts.has(rollup.accountId)) {
    return { slice: rollup.cost, direct: 0, principalSplit: false };
  }
  let slice = 0;
  let principalSplit = false;
  for (const modelKey of MODEL_KEYS) {
    const byUser = rollup.models[modelKey]?.byUser ?? {};
    for (const [key, entry] of Object.entries(byUser)) {
      if (!matches(key)) continue;
      slice += entry.cost;
      principalSplit = true;
    }
  }
  const direct = rollup.cost - slice;
  if (direct < -TOLERANCE) {
    throw new CombinedInvariantError(
      `${rollup.accountId} ${rollup.date} slice exceeds cost`,
    );
  }
  return { slice, direct: Math.max(direct, 0), principalSplit };
}

type BedrockTotals = {
  exact: number;
  slice: number;
  direct: number;
  estimated: boolean;
  provisional: boolean;
};

function bedrockTotals(
  rollups: readonly DatedDailyRollup[],
  gateway: Gateway,
): BedrockTotals {
  const accounts = new Set(gateway.accountIds);
  const matches = gatewayMatcher(gateway.principals);
  const totals: BedrockTotals = {
    exact: 0,
    slice: 0,
    direct: 0,
    estimated: false,
    provisional: false,
  };
  for (const rollup of rollups) {
    const split = splitRollup(rollup, accounts, matches);
    totals.exact += rollup.cost;
    totals.slice += split.slice;
    totals.direct += split.direct;
    if (split.principalSplit) totals.estimated = true;
    if (!rollup.costFinalized) totals.provisional = true;
  }
  if (totals.provisional) totals.estimated = true;
  return totals;
}

// ---- LiteLLM side ----------------------------------------------------------

const rowsOf = (side: LiteLLMSide): readonly LiteLLMDailyRow[] | null =>
  side.kind === "rows" ? side.rows : null;

const totalSpend = (rows: readonly LiteLLMDailyRow[]): number =>
  rows.reduce((sum, r) => sum + (r.metrics?.spend ?? 0), 0);

function providerSpend(rows: readonly LiteLLMDailyRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    for (const [provider, value] of Object.entries(
      row.breakdown?.providers ?? {},
    )) {
      out.set(provider, (out.get(provider) ?? 0) + (value.metrics?.spend ?? 0));
    }
  }
  return out;
}

// ---- figures ---------------------------------------------------------------

export function computeOrganisation(input: {
  rollups: readonly DatedDailyRollup[];
  gateway: Gateway;
  litellm: LiteLLMSide;
}): CombinedOrganisationFigure {
  const bedrock = bedrockTotals(input.rollups, input.gateway);
  const rows = rowsOf(input.litellm);
  const litellm = rows ? totalSpend(rows) : null;
  const providers = rows ? providerSpend(rows) : new Map<string, number>();
  const byProvider = [...providers.entries()]
    .map(([provider, spend]) => ({ provider, spend: round6(spend) }))
    .sort((a, b) => b.spend - a.spend || a.provider.localeCompare(b.provider));
  let reconciliation: CombinedOrganisationFigure["reconciliation"] = null;
  if (rows) {
    const litellmBedrock = BEDROCK_PROVIDERS.reduce(
      (sum, p) => sum + (providers.get(p) ?? 0),
      0,
    );
    const difference = bedrock.slice - litellmBedrock;
    reconciliation = {
      litellmBedrock: round6(litellmBedrock),
      difference: round6(difference),
      differencePct:
        round6(bedrock.slice) === 0 ? null : round6(difference / bedrock.slice),
    };
  }
  return {
    bedrockExact: round6(bedrock.exact),
    gatewaySlice: round6(bedrock.slice),
    bedrockDirect: round6(bedrock.direct),
    litellm: roundOrNull(litellm),
    combined: litellm === null ? null : round6(bedrock.direct + litellm),
    byProvider,
    reconciliation,
    costEstimated: bedrock.estimated,
    provisional: bedrock.provisional,
  };
}

export type CombinedTeamComputation = {
  bedrockDirect: number;
  gatewaySlice: number;
  litellm: number | null;
  combined: number | null;
  reason?: "not-linked";
  costEstimated: boolean;
  provisional: boolean;
};

export function computeTeam(input: {
  teamId: string;
  rollups: readonly DatedDailyRollup[];
  gateway: Gateway;
  litellm: LiteLLMSide;
}): CombinedTeamComputation {
  const bedrock = bedrockTotals(
    input.rollups.filter((r) => r.teamId === input.teamId),
    input.gateway,
  );
  const rows = rowsOf(input.litellm);
  const litellm = rows ? totalSpend(rows) : null;
  return {
    bedrockDirect: round6(bedrock.direct),
    gatewaySlice: round6(bedrock.slice),
    litellm: roundOrNull(litellm),
    combined: litellm === null ? null : round6(bedrock.direct + litellm),
    ...(input.litellm.kind === "not-linked"
      ? { reason: "not-linked" as const }
      : {}),
    costEstimated: bedrock.estimated,
    provisional: bedrock.provisional,
  };
}

export function computePerson(input: {
  rollups: readonly DatedDailyRollup[];
  gateway: Gateway;
  usageKeys: ReadonlySet<string>;
  litellm: LiteLLMSide;
}): CombinedPersonFigure {
  const accounts = new Set(input.gateway.accountIds);
  const matches = gatewayMatcher(input.gateway.principals);
  let direct = 0;
  let provisional = false;
  for (const rollup of input.rollups) {
    if (!rollup.costFinalized) provisional = true;
    if (accounts.has(rollup.accountId)) continue;
    for (const modelKey of MODEL_KEYS) {
      const byUser = rollup.models[modelKey]?.byUser ?? {};
      for (const [raw, entry] of Object.entries(byUser)) {
        if (matches(raw)) continue;
        if (input.usageKeys.has(canonicalUsageIdentity(raw).key)) {
          direct += entry.cost;
        }
      }
    }
  }
  const rows = rowsOf(input.litellm);
  const notConfigured = input.litellm.kind === "not-configured";
  const litellm = notConfigured ? null : rows ? totalSpend(rows) : 0;
  return {
    bedrockDirect: round6(direct),
    litellm: roundOrNull(litellm),
    litellmUser: rows !== null,
    combined: litellm === null ? null : round6(direct + litellm),
    costEstimated: true,
    provisional,
  };
}
