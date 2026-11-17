import { describe, expect, it } from "vitest";

import {
  AppConfigSchema,
  LITELLM_OPERATION_NAMES,
  LiteLLMGatewayConfigSchema,
} from "../index";

// Source: docs/specs/2026-05-15-system-architecture.md — "Configuration file"
// (v1 keys table; Validation: one strict schema, unknown keys fail, secret-
// shaped and authorization keys rejected; Q1 narrow-only; Q2 no authorization
// assignments; Q3 v1 scope; A4, A8), Access Control T35 (each authorization
// key, `enabled: true`, an unknown key → rejected), T36 (secret-shaped key),
// implementation-phases CFG Verify; Rule 60.19, 60.22.
//
// Contract: `AppConfigSchema` (strict, every key optional) and the inferred
// type `AppConfig`, both exported from packages/shared. `litellm` is the
// former LiteLLMGatewayConfigSchema, which stays exported and equivalent.
const parse = (v: unknown) => AppConfigSchema.safeParse(v);

const FULL = {
  litellm: {
    operations: {
      resetMemberSpend: { enabled: false },
      deleteKey: { enabled: false },
    },
  },
  display: { defaultDateRange: "7d", orgName: "Acme Corp" },
  data: { retention: { dailyRollupDays: 730 } },
};

describe("AppConfigSchema — valid files", () => {
  it("accepts an empty configuration (A5: an empty file is valid)", () => {
    expect(parse({}).success).toBe(true);
  });

  it("accepts a file that sets every v1 key", () => {
    const r = parse(FULL);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(FULL);
  });

  it.each(["7d", "30d", "90d"])("accepts display.defaultDateRange %s", (v) => {
    expect(parse({ display: { defaultDateRange: v } }).success).toBe(true);
  });

  it.each([30, 365, 3650])(
    "accepts data.retention.dailyRollupDays %i (boundaries 30..3650)",
    (n) => {
      expect(
        parse({ data: { retention: { dailyRollupDays: n } } }).success,
      ).toBe(true);
    },
  );

  it("accepts every allowlisted operation with enabled:false, including deleteKey (secret-shape exempt)", () => {
    const operations = Object.fromEntries(
      LITELLM_OPERATION_NAMES.map((n) => [n, { enabled: false }]),
    );
    expect(parse({ litellm: { operations } }).success).toBe(true);
  });
});

describe("AppConfigSchema — the litellm branch is the former gateway schema (A8)", () => {
  const cases: unknown[] = [
    { operations: {} },
    { operations: { resetMemberSpend: { enabled: false } } },
    { operations: { createTeam: { enabled: true } } },
    { operations: { deleteTeam: { enabled: false } } },
    { operations: { createTeam: { enabled: false, route: "/x" } } },
    { operations: {}, routes: ["/x"] },
  ];
  it.each(cases.map((c, i) => [i, c] as const))(
    "case %i: the branch accepts exactly what LiteLLMGatewayConfigSchema accepts",
    (_i, branch) => {
      expect(parse({ litellm: branch }).success).toBe(
        LiteLLMGatewayConfigSchema.safeParse(branch).success,
      );
    },
  );
});

describe("AppConfigSchema — rejected (T35, T36, Validation)", () => {
  it.each([
    ["an unknown top-level key", { colour: "blue" }],
    ["an unknown display key", { display: { colour: "blue" } }],
    ["an unknown data key", { data: { sync: {} } }],
    ["an unknown retention key", { data: { retention: { hours: 1 } } }],
    ["a non-object document", []],
    ["a null section", { display: null }],
  ])("rejects %s", (_n, doc) => {
    expect(parse(doc).success).toBe(false);
  });

  it.each([
    ["orgName as a number", { display: { orgName: 5 } }],
    ["an empty orgName", { display: { orgName: "" } }],
    ["defaultDateRange 14d", { display: { defaultDateRange: "14d" } }],
    ["defaultDateRange custom", { display: { defaultDateRange: "custom" } }],
    ["dailyRollupDays 29", { data: { retention: { dailyRollupDays: 29 } } }],
    [
      "dailyRollupDays 3651",
      { data: { retention: { dailyRollupDays: 3651 } } },
    ],
    [
      "dailyRollupDays 365.5",
      { data: { retention: { dailyRollupDays: 365.5 } } },
    ],
    [
      "dailyRollupDays as a string",
      { data: { retention: { dailyRollupDays: "365" } } },
    ],
  ])("rejects a wrong type or out-of-range value: %s", (_n, doc) => {
    expect(parse(doc).success).toBe(false);
  });

  // Q1 / LD19: narrow only.
  it.each([
    ["enabled: true", { enabled: true }],
    ["enabled as the string 'false'", { enabled: "false" }],
    ["enabled: null", { enabled: null }],
    ["an extra route field", { enabled: false, route: "/team/delete" }],
  ])("rejects an operation entry with %s (Q1)", (_n, entry) => {
    expect(
      parse({ litellm: { operations: { createTeam: entry } } }).success,
    ).toBe(false);
  });

  it("rejects an unknown operation name (the allowlist is the only source of names)", () => {
    expect(
      parse({ litellm: { operations: { deleteTeam: { enabled: false } } } })
        .success,
    ).toBe(false);
  });

  // Secret-shaped keys: a segment containing secret, password, passwd, token,
  // credential, apikey/api_key, privatekey/private_key, or equal to `key`.
  it.each([
    "secret",
    "clientSecret",
    "password",
    "passwd",
    "accessToken",
    "credentials",
    "apiKey",
    "api_key",
    "privateKey",
    "private_key",
    "key",
  ])(
    "rejects the secret-shaped key %s at the top level and under display (T36)",
    (k) => {
      expect(parse({ [k]: "x" }).success).toBe(false);
      expect(parse({ display: { [k]: "x" } }).success).toBe(false);
      expect(parse({ litellm: { operations: {}, [k]: "x" } }).success).toBe(
        false,
      );
    },
  );

  // Q2: authorization assignments, identity-provider and dev-login selection.
  it.each([
    "roles",
    "roleGrants",
    "grants",
    "adminScopes",
    "admins",
    "affiliations",
    "identityLinks",
    "groupMappings",
    "passwordUsers",
    "masterUser",
    "auth",
    "identityProvider",
    "devLogin",
    "accessMode",
  ])("rejects the authorization key %s at the top level (T35, Q2)", (k) => {
    expect(parse({ [k]: {} }).success).toBe(false);
    expect(parse({ [k]: ["internal-admin"] }).success).toBe(false);
  });

  it("rejects an authorization key nested where a v1 section exists (T35)", () => {
    expect(
      parse({ litellm: { operations: {}, roles: ["internal-admin"] } }).success,
    ).toBe(false);
    expect(parse({ display: { orgName: "x", adminScopes: [] } }).success).toBe(
      false,
    );
  });
});
