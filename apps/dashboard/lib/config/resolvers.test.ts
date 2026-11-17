import { AppConfigSchema } from "@llm-usage-lens/shared";
import { describe, expect, it } from "vitest";

import {
  resolveDailyRollupDays,
  resolveDefaultDateRange,
  resolveOrgName,
} from "./resolvers";

// Source: docs/specs/2026-05-15-system-architecture.md — "Configuration file"
// (Precedence: config.yaml > database > environment variable > built-in
// default; v1 keys table: display.defaultDateRange default 30d,
// display.orgName default "Organization", data.retention.dailyRollupDays
// default 365; "Moved environment values" and A10: file > NEXT_PUBLIC_ORG_NAME
// (deprecated) > default); Data Model — "TTL and Data Retention"; the
// operation-toggle resolver is tested in lib/litellm/operation-settings
// .integration.test.ts and against DynamoDB Local in the toggles route test.
//
// Contract (apps/dashboard/lib/config/resolvers.ts, pure):
//   resolveDefaultDateRange(config): { value: "7d"|"30d"|"90d"; source: "file"|"default" }
//   resolveOrgName(config, deprecatedEnvOrgName?): { value: string; source: "file"|"env"|"default" }
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

describe("resolveOrgName (A10: file > deprecated NEXT_PUBLIC_ORG_NAME > default)", () => {
  it("file only", () => {
    expect(resolveOrgName(cfg({ display: { orgName: "Acme" } }))).toEqual({
      value: "Acme",
      source: "file",
    });
  });

  it("both: the file wins over the variable", () => {
    expect(
      resolveOrgName(cfg({ display: { orgName: "Acme" } }), "Legacy"),
    ).toEqual({ value: "Acme", source: "file" });
  });

  it("variable only: the deprecated fallback still works", () => {
    expect(resolveOrgName(cfg({}), "Legacy")).toEqual({
      value: "Legacy",
      source: "env",
    });
  });

  it.each([undefined, ""])(
    "neither (variable %j): 'Organization', source 'default'",
    (envValue) => {
      expect(resolveOrgName(cfg({}), envValue)).toEqual({
        value: "Organization",
        source: "default",
      });
    },
  );

  it("removing the key from the file falls back to the variable (not to a stored value)", () => {
    const withKey = resolveOrgName(cfg({ display: { orgName: "Acme" } }), "L");
    const without = resolveOrgName(cfg({}), "L");
    expect([withKey.value, without.value]).toEqual(["Acme", "L"]);
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
