import type { AppConfig } from "@llm-usage-lens/shared";

// Source: docs/specs/2026-05-15-system-architecture.md — "Configuration file"
// (Precedence: config.yaml > database > environment variable > built-in
// default; v1 keys; A10 for the deprecated NEXT_PUBLIC_ORG_NAME). Pure: each
// resolver reports the value and where it came from. The operation toggles
// resolve in lib/litellm/operation-settings.ts.

export type DateRangePresetSetting = "7d" | "30d" | "90d";

export const DEFAULT_DATE_RANGE_PRESET: DateRangePresetSetting = "30d";
export const DEFAULT_ORG_NAME = "Organization";
// Data Model — "TTL and Data Retention".
export const DEFAULT_DAILY_ROLLUP_DAYS = 365;

export function resolveDefaultDateRange(config: AppConfig): {
  value: DateRangePresetSetting;
  source: "file" | "default";
} {
  const fromFile = config.display?.defaultDateRange;
  return fromFile === undefined
    ? { value: DEFAULT_DATE_RANGE_PRESET, source: "default" }
    : { value: fromFile, source: "file" };
}

export function resolveOrgName(
  config: AppConfig,
  deprecatedEnvOrgName?: string,
): { value: string; source: "file" | "env" | "default" } {
  const fromFile = config.display?.orgName;
  if (fromFile !== undefined) return { value: fromFile, source: "file" };
  if (deprecatedEnvOrgName)
    return { value: deprecatedEnvOrgName, source: "env" };
  return { value: DEFAULT_ORG_NAME, source: "default" };
}

export function resolveDailyRollupDays(config: AppConfig): {
  value: number;
  source: "file" | "default";
} {
  const fromFile = config.data?.retention?.dailyRollupDays;
  return fromFile === undefined
    ? { value: DEFAULT_DAILY_ROLLUP_DAYS, source: "default" }
    : { value: fromFile, source: "file" };
}
