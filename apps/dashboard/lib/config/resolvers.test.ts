import { AppConfigSchema } from "@llm-usage-lens/shared";
import { describe, expect, it } from "vitest";

import { resolveDailyRollupDays, resolveDefaultDateRange } from "./resolvers";

// Source: docs/specs/2026-05-15-system-architecture.md — "Configuration file"
// (Precedence: config.yaml > database > environment variable > built-in
// default; v1 keys table: display.defaultDateRange default 30d,
// data.retention.dailyRollupDays default 365; display.orgName is accepted and
// ignored, D-F-13, so its resolver is gone); Data Model — "TTL and Data Retention"; the
// operation-toggle resolver is tested in lib/litellm/operation-settings
// .integration.test.ts and against DynamoDB Local in the toggles route test.
//
// Contract (apps/dashboard/lib/config/resolvers.ts, pure):
//   resolveDefaultDateRange(config): { value: "7d"|"30d"|"90d"; source: "file"|"default" }
//   resolveDailyRollupDays(config): { value: number; source: "file"|"default" }
// `config` is a parsed AppConfig; an undefined or empty env value counts as unset.
const cfg = (v: unknown) => AppConfigSchema.parse(v);

describe("resolveDefaultDateRange", () => {
  it("file only: the file's preset, source 'file'", () => {
    expect(
      resolveDefaultDateRange(cfg({ display: { defaultDateRange: "7d" } })),
    ).toEqual({ value: "7d", source: "file" });
  });

  it("neither: 30d, source 'default'", () => {
    expect(resolveDefaultDateRange(cfg({}))).toEqual({
      value: "30d",
      source: "default",
    });
    expect(resolveDefaultDateRange(cfg({ display: {} }))).toEqual({
      value: "30d",
      source: "default",
    });
  });
});

describe("resolveDailyRollupDays", () => {
  it("file only: the file's value, source 'file'", () => {
    expect(
      resolveDailyRollupDays(
        cfg({ data: { retention: { dailyRollupDays: 730 } } }),
      ),
    ).toEqual({ value: 730, source: "file" });
  });

  it("neither: 365, source 'default' (Data Model default)", () => {
    expect(resolveDailyRollupDays(cfg({}))).toEqual({
      value: 365,
      source: "default",
    });
  });
});
