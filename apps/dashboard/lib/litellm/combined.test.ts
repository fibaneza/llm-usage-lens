// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildRollup } from "@/test/fixtures/rollup-builder";
import type { RollupSpec } from "@/test/fixtures/rollup-builder";

import {
  BEDROCK_PROVIDERS,
  CombinedInvariantError,
  combinedVisibility,
  computeOrganisation,
  computePerson,
  computeTeam,
  gatewayMatcher,
  isGatewayConfigured,
} from "./combined";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage (L6)":
// Gateway configuration (Matching: exact only, no substring; an iam-role R
// matches a byUser key equal to R, arn:aws:sts::<12d>:assumed-role/R/<session>
// or arn:aws:iam::<12d>:role/[path/]R, case-insensitively; a usage-key matches
// the key equal to it; the AROA...:<session> principalId form is not matched),
// The computation (slice, direct, organisation, reconciliation with
// BEDROCK_PROVIDERS = ["bedrock"], team, person, estimates, rounding,
// visibility), States, Tests ("counted-once fixture ... in both gateway
// forms"); shared contract 5; Data Model - DailyRollup, byUser keys; Rule 20.3
// (estimate flags), Rule 60.24a (matcher/visibility tables complete, the rest
// representative); threats LT29, LT33.
//
// Contract for the developer (apps/dashboard/lib/litellm/combined.ts,
// server-only, pure, no I/O). All money outputs are rounded to 6 dp, with
// `combined` computed from the UNROUNDED parts:
//   BEDROCK_PROVIDERS: readonly ["bedrock"]
//   class CombinedInvariantError extends Error   (a direct cost below -1e-6)
//   type Gateway = { principals: {type:"iam-role"|"usage-key"; value:string}[];
//                    accountIds: string[] }
//   type LiteLLMDailyRow = { date: string; metrics?: { spend?: number };
//     breakdown?: { providers?: Record<string, { metrics?: { spend?: number } }> } }
//   type LiteLLMSide =
//     | { kind: "rows"; rows: readonly LiteLLMDailyRow[] }
//     | { kind: "not-configured" }   // LD37
//     | { kind: "not-linked" }       // computeTeam only
//     | { kind: "no-user" }          // computePerson only
//   gatewayMatcher(principals): (rawByUserKey: string) => boolean
//   isGatewayConfigured(gateway): boolean
//   combinedVisibility(globalReader, gatewayConfigured): "show"|"warn"|"hidden"
//   computeOrganisation({ rollups, gateway, litellm }) -> {
//     bedrockExact, gatewaySlice, bedrockDirect, litellm: number|null,
//     combined: number|null, byProvider: {provider, spend}[] (spend desc, then
//     name), reconciliation: {litellmBedrock, difference, differencePct|null}|null,
//     costEstimated, provisional }
//   computeTeam({ teamId, rollups, gateway, litellm }) -> { bedrockDirect,
//     gatewaySlice, litellm, combined, reason?: "not-linked", costEstimated,
//     provisional }   (uses only rollups whose teamId matches)
//   computePerson({ rollups, gateway, usageKeys: ReadonlySet<string>, litellm })
//     -> { bedrockDirect, litellm, litellmUser, combined, costEstimated: true,
//     provisional }   (byUser keys are canonicalised before the usageKeys match)

const GW_ACCT = "000000000002";
const SHARED_ACCT = "000000000001";
const ROLE = "litellm-bedrock";
const ROLE_ARN = `arn:aws:sts::111122223333:assumed-role/${ROLE}/litellm-session`;
const ALICE = "alice@example.com";

const day = "2026-11-03";
const rollup = (spec: Partial<RollupSpec> & Pick<RollupSpec, "models">) =>
  buildRollup({ date: day, ...spec });
const unfinalised = (r: ReturnType<typeof buildRollup>) => ({
  ...r,
  costFinalized: false,
});

const row = (
  spend: number,
  providers: Record<string, number> = {},
): { date: string; metrics: { spend: number }; breakdown?: unknown } => ({
  date: day,
  metrics: { spend },
  breakdown: {
    providers: Object.fromEntries(
      Object.entries(providers).map(([p, s]) => [p, { metrics: { spend: s } }]),
    ),
  },
});
const rows = (...r: ReturnType<typeof row>[]) =>
  ({ kind: "rows", rows: r }) as never;
// The counted-once LiteLLM report: $5.20 on Bedrock and $1 on another provider.
const REPORT = rows(row(6.2, { bedrock: 5.2, openai: 1 }));

const ACCOUNT_FORM = { principals: [], accountIds: [GW_ACCT] };
const PRINCIPAL_FORM = {
  principals: [{ type: "iam-role" as const, value: ROLE }],
  accountIds: [],
};
const NONE = { principals: [], accountIds: [] };

// A person spends $10 direct on Bedrock and $5 through LiteLLM on Bedrock.
// Account form: LiteLLM's role calls Bedrock in its own account.
const accountFormRollups = () => [
  rollup({
    accountId: SHARED_ACCT,
    teamId: "team-a",
    teamName: "A",
    models: { "claude-sonnet": { cost: 10, byUser: { [ALICE]: 10 } } },
  }),
  rollup({
    accountId: GW_ACCT,
    teamId: "team-gw",
    teamName: "GW",
    models: { "claude-sonnet": { cost: 5, byUser: { [ROLE_ARN]: 5 } } },
  }),
];
// Principal form: the role shares the person's account.
const principalFormRollups = () => [
  rollup({
    accountId: SHARED_ACCT,
    teamId: "team-a",
    teamName: "A",
    models: {
      "claude-sonnet": { cost: 15, byUser: { [ALICE]: 10, [ROLE_ARN]: 5 } },
    },
  }),
];

describe("BEDROCK_PROVIDERS", () => {
  it("is exactly bedrock (a tested constant; the reconciliation uses it)", () => {
    expect([...BEDROCK_PROVIDERS]).toEqual(["bedrock"]);
  });
});

describe("the counted-once fixture (organisation; LD38, LT29)", () => {
  it.each([
    ["account form", accountFormRollups, ACCOUNT_FORM],
    ["principal form", principalFormRollups, PRINCIPAL_FORM],
  ])(
    "%s: combined 16.20 not 21.20, slice 5, reconciliation -0.20",
    (_n, makeRollups, gateway) => {
      const org = computeOrganisation({
        rollups: makeRollups(),
        gateway,
        litellm: REPORT,
      });
      expect(org.bedrockExact).toBeCloseTo(15, 6);
      expect(org.gatewaySlice).toBeCloseTo(5, 6);
      expect(org.bedrockDirect).toBeCloseTo(10, 6);
      expect(org.litellm).toBeCloseTo(6.2, 6);
      expect(org.combined).toBeCloseTo(16.2, 6);
      expect(org.combined).not.toBeCloseTo(21.2, 2);
      expect(org.reconciliation?.litellmBedrock).toBeCloseTo(5.2, 6);
      expect(org.reconciliation?.difference).toBeCloseTo(-0.2, 6);
      expect(org.reconciliation?.differencePct).toBeCloseTo(-0.04, 6);
    },
  );

  it("labels non-Bedrock spend by provider; it appears only in the LiteLLM source, spend descending", () => {
    const org = computeOrganisation({
      rollups: accountFormRollups(),
      gateway: ACCOUNT_FORM,
      litellm: REPORT,
    });
    expect(org.byProvider).toEqual([
      { provider: "bedrock", spend: 5.2 },
      { provider: "openai", spend: 1 },
    ]);
  });

  it("orders equal provider spend by name", () => {
    const org = computeOrganisation({
      rollups: accountFormRollups(),
      gateway: ACCOUNT_FORM,
      litellm: rows(row(2, { zeta: 1, alpha: 1 })),
    });
    expect(org.byProvider.map((p) => p.provider)).toEqual(["alpha", "zeta"]);
  });

  it("a provider not named in BEDROCK_PROVIDERS never counts toward the Bedrock reconciliation", () => {
    const org = computeOrganisation({
      rollups: accountFormRollups(),
      gateway: ACCOUNT_FORM,
      litellm: rows(row(9, { bedrock_converse: 4, openai: 3, bedrock: 2 })),
    });
    expect(org.reconciliation?.litellmBedrock).toBeCloseTo(2, 6);
    expect(org.litellm).toBeCloseTo(9, 6);
  });

  it("sums provider spend and total spend across days and pages of rows", () => {
    const org = computeOrganisation({
      rollups: accountFormRollups(),
      gateway: ACCOUNT_FORM,
      litellm: rows(
        row(3, { bedrock: 2, openai: 1 }),
        row(4, { bedrock: 3.2, openai: 0 }),
      ),
    });
    expect(org.litellm).toBeCloseTo(7, 6);
    expect(org.reconciliation?.litellmBedrock).toBeCloseTo(5.2, 6);
  });

  it("differencePct is null when the slice is 0, and the reconciliation is still present (never thresholded away)", () => {
    const org = computeOrganisation({
      rollups: accountFormRollups().slice(0, 1),
      gateway: ACCOUNT_FORM,
      litellm: REPORT,
    });
    expect(org.gatewaySlice).toBe(0);
    expect(org.reconciliation).not.toBeNull();
    expect(org.reconciliation?.differencePct).toBeNull();
    expect(org.reconciliation?.difference).toBeCloseTo(-5.2, 6);
  });

  it("an unconfigured gateway has slice 0 and subtracts nothing (the double count the warning names)", () => {
    const org = computeOrganisation({
      rollups: accountFormRollups(),
      gateway: NONE,
      litellm: REPORT,
    });
    expect(org.gatewaySlice).toBe(0);
    expect(org.bedrockDirect).toBeCloseTo(15, 6);
    expect(org.combined).toBeCloseTo(21.2, 6);
  });

  it("LiteLLM not configured (LD37): Bedrock parts only, litellm and combined null, no providers, no reconciliation", () => {
    const org = computeOrganisation({
      rollups: accountFormRollups(),
      gateway: ACCOUNT_FORM,
      litellm: { kind: "not-configured" },
    });
    expect(org.bedrockExact).toBeCloseTo(15, 6);
    expect(org.gatewaySlice).toBeCloseTo(5, 6);
    expect(org.bedrockDirect).toBeCloseTo(10, 6);
    expect(org.litellm).toBeNull();
    expect(org.combined).toBeNull();
    expect(org.byProvider).toEqual([]);
    expect(org.reconciliation).toBeNull();
  });

  it("no rollups and no LiteLLM rows is all zeros, not an error", () => {
    const org = computeOrganisation({
      rollups: [],
      gateway: NONE,
      litellm: rows(),
    });
    expect(org).toMatchObject({
      bedrockExact: 0,
      gatewaySlice: 0,
      bedrockDirect: 0,
      litellm: 0,
      combined: 0,
      byProvider: [],
    });
  });
});

describe("gatewayMatcher (exact only; LD38, LT29)", () => {
  const matchRole = gatewayMatcher([{ type: "iam-role", value: ROLE }]);
  it.each([
    ["the bare role name", ROLE, true],
    ["the bare role name, other case", "LiteLLM-Bedrock", true],
    ["an assumed-role sts ARN", ROLE_ARN, true],
    [
      "an sts ARN, role name in other case",
      "arn:aws:sts::111122223333:assumed-role/LITELLM-BEDROCK/s1",
      true,
    ],
    ["an iam role ARN", `arn:aws:iam::111122223333:role/${ROLE}`, true],
    [
      "an iam role ARN with a path",
      `arn:aws:iam::111122223333:role/service-role/team/${ROLE}`,
      true,
    ],
    ["a role name with a longer suffix", `${ROLE}-2`, false],
    ["a role name with a prefix", `x${ROLE}`, false],
    [
      "an sts ARN of a longer role name",
      `arn:aws:sts::111122223333:assumed-role/${ROLE}-2/s1`,
      false,
    ],
    [
      "an sts ARN whose SESSION is the role name (no substring)",
      `arn:aws:sts::111122223333:assumed-role/other-role/${ROLE}`,
      false,
    ],
    [
      "an iam USER ARN with the same name",
      `arn:aws:iam::111122223333:user/${ROLE}`,
      false,
    ],
    [
      "an ARN whose account is not 12 digits",
      `arn:aws:sts::2222:assumed-role/${ROLE}/s1`,
      false,
    ],
    [
      "the AROA principalId form (carries no role name)",
      `AROAXXXXXXXXXXXXXXXXX:${ROLE}`,
      false,
    ],
    ["a person", ALICE, false],
  ])("iam-role: %s", (_n, key, expected) => {
    expect(matchRole(key)).toBe(expected);
  });

  const matchKey = gatewayMatcher([
    { type: "usage-key", value: "svc-gateway" },
  ]);
  it.each([
    ["the exact key", "svc-gateway", true],
    ["a longer key", "svc-gateway-2", false],
    ["a prefixed key", "xsvc-gateway", false],
    [
      "an ARN ending in the key",
      "arn:aws:sts::111122223333:assumed-role/r/svc-gateway",
      false,
    ],
  ])("usage-key: %s", (_n, key, expected) => {
    expect(matchKey(key)).toBe(expected);
  });

  it("the AROA principalId form matches when the Admin enters it as a usage-key (runbook 8)", () => {
    const m = gatewayMatcher([
      { type: "usage-key", value: "AROAXXXXXXXXXXXXXXXXX:litellm-session" },
    ]);
    expect(m("AROAXXXXXXXXXXXXXXXXX:litellm-session")).toBe(true);
    expect(m("AROAXXXXXXXXXXXXXXXXX:other")).toBe(false);
  });

  it("trims configured values and matches any of several principals", () => {
    const m = gatewayMatcher([
      { type: "iam-role", value: `  ${ROLE} ` },
      { type: "usage-key", value: "k2" },
    ]);
    expect(m(ROLE)).toBe(true);
    expect(m("k2")).toBe(true);
    expect(m("k3")).toBe(false);
  });

  it("no principals match nothing", () => {
    expect(gatewayMatcher([])(ROLE)).toBe(false);
  });
});

describe("isGatewayConfigured", () => {
  it.each([
    ["empty", NONE, false],
    ["a principal", PRINCIPAL_FORM, true],
    ["an account id", ACCOUNT_FORM, true],
  ])("%s", (_n, gateway, expected) => {
    expect(isGatewayConfigured(gateway)).toBe(expected);
  });
});

describe("combinedVisibility (2x2; Visibility)", () => {
  it.each([
    [true, true, "show"],
    [true, false, "warn"],
    [false, true, "show"],
    [false, false, "hidden"],
  ] as const)(
    "global reader %s, gateway configured %s -> %s",
    (reader, configured, expected) => {
      expect(combinedVisibility(reader, configured)).toBe(expected);
    },
  );
});

describe("the slice (gateway account vs principal)", () => {
  it("a gateway account's whole rollup cost is the slice, nonModel included, whatever its byUser", () => {
    const org = computeOrganisation({
      rollups: [
        rollup({
          accountId: GW_ACCT,
          models: { "claude-sonnet": { cost: 5, byUser: { someone: 1 } } },
          nonModel: { guardrails: { cost: 2, recurring: true } },
        }),
      ],
      gateway: ACCOUNT_FORM,
      litellm: rows(),
    });
    expect(org.bedrockExact).toBeCloseTo(7, 6);
    expect(org.gatewaySlice).toBeCloseTo(7, 6);
    expect(org.bedrockDirect).toBeCloseTo(0, 6);
  });

  it("outside a gateway account the slice is the principals' byUser cost summed over every model; nonModel stays direct", () => {
    const org = computeOrganisation({
      rollups: [
        rollup({
          accountId: SHARED_ACCT,
          models: {
            "claude-sonnet": { cost: 8, byUser: { [ROLE_ARN]: 3, [ALICE]: 5 } },
            "claude-haiku": { cost: 4, byUser: { [ROLE_ARN]: 2, other: 2 } },
          },
          nonModel: { guardrails: { cost: 2, recurring: true } },
        }),
      ],
      gateway: PRINCIPAL_FORM,
      litellm: rows(),
    });
    expect(org.bedrockExact).toBeCloseTo(14, 6);
    expect(org.gatewaySlice).toBeCloseTo(5, 6);
    expect(org.bedrockDirect).toBeCloseTo(9, 6);
  });

  it("both forms together: the account is counted once, not also by its principals", () => {
    const org = computeOrganisation({
      rollups: [
        rollup({
          accountId: GW_ACCT,
          models: { "claude-sonnet": { cost: 5, byUser: { [ROLE_ARN]: 5 } } },
        }),
      ],
      gateway: { ...PRINCIPAL_FORM, accountIds: [GW_ACCT] },
      litellm: rows(),
    });
    expect(org.gatewaySlice).toBeCloseTo(5, 6);
    expect(org.bedrockDirect).toBeCloseTo(0, 6);
  });
});

describe("invariant: direct = cost - slice", () => {
  it("a slice above the rollup cost beyond 1e-6 is an invariant defect (CombinedInvariantError, mapped to 500)", () => {
    const broken = rollup({
      accountId: SHARED_ACCT,
      models: { "claude-sonnet": { cost: 10, byUser: { [ROLE_ARN]: 12 } } },
    });
    expect(() =>
      computeOrganisation({
        rollups: [broken],
        gateway: PRINCIPAL_FORM,
        litellm: rows(),
      }),
    ).toThrow(CombinedInvariantError);
  });

  it("a slice within 1e-6 of the cost is clamped: direct 0, never negative", () => {
    const edge = rollup({
      accountId: SHARED_ACCT,
      models: {
        "claude-sonnet": { cost: 10, byUser: { [ROLE_ARN]: 10.0000005 } },
      },
    });
    const org = computeOrganisation({
      rollups: [edge],
      gateway: PRINCIPAL_FORM,
      litellm: rows(),
    });
    expect(org.bedrockDirect).toBeGreaterThanOrEqual(0);
    expect(Math.abs(org.bedrockDirect)).toBeLessThan(1e-5);
  });
});

describe("rounding (6 dp; combined from the unrounded parts)", () => {
  it("rounds float noise away: 0.1 + 0.2 is 0.3", () => {
    const org = computeOrganisation({
      rollups: [
        rollup({ models: { "claude-sonnet": { cost: 0.1 } } }),
        rollup({ models: { "claude-opus": { cost: 0.2 } } }),
      ],
      gateway: NONE,
      litellm: rows(),
    });
    expect(org.bedrockExact).toBe(0.3);
  });

  it("combined is the rounded sum of unrounded parts, not the sum of rounded parts", () => {
    const org = computeOrganisation({
      rollups: [rollup({ models: { "claude-sonnet": { cost: 1.0000004 } } })],
      gateway: NONE,
      litellm: rows(row(2.0000004)),
    });
    expect(org.bedrockDirect).toBe(1);
    expect(org.litellm).toBe(2);
    expect(org.combined).toBe(3.000001);
  });
});

describe("estimates and provisional flags (Estimates; Rule 20.3)", () => {
  it("an account-form fixture of finalised days is exact and final", () => {
    const org = computeOrganisation({
      rollups: accountFormRollups(),
      gateway: ACCOUNT_FORM,
      litellm: REPORT,
    });
    expect(org.costEstimated).toBe(false);
    expect(org.provisional).toBe(false);
  });

  it("a principal split makes the organisation figure an estimate", () => {
    const org = computeOrganisation({
      rollups: principalFormRollups(),
      gateway: PRINCIPAL_FORM,
      litellm: REPORT,
    });
    expect(org.costEstimated).toBe(true);
    expect(org.provisional).toBe(false);
  });

  it("an unfinalised day (today) is provisional and an estimate", () => {
    const [first, second] = accountFormRollups();
    const org = computeOrganisation({
      rollups: [unfinalised(first!), second!],
      gateway: ACCOUNT_FORM,
      litellm: REPORT,
    });
    expect(org.provisional).toBe(true);
    expect(org.costEstimated).toBe(true);
  });
});

describe("computeTeam (Team T, linked)", () => {
  const teamRollups = () => [
    ...accountFormRollups(),
    rollup({
      accountId: "123456789012",
      teamId: "team-other",
      teamName: "Other",
      models: { "claude-sonnet": { cost: 100, byUser: { z: 100 } } },
    }),
  ];

  it("direct Bedrock of the team's rollups plus the linked LiteLLM team's spend; other teams are ignored", () => {
    const team = computeTeam({
      teamId: "team-a",
      rollups: teamRollups(),
      gateway: ACCOUNT_FORM,
      litellm: rows(row(4, { bedrock: 4 })),
    });
    expect(team.bedrockDirect).toBeCloseTo(10, 6);
    expect(team.gatewaySlice).toBe(0);
    expect(team.litellm).toBeCloseTo(4, 6);
    expect(team.combined).toBeCloseTo(14, 6);
    expect(team).not.toHaveProperty("reason");
  });

  it("a team whose account is a gateway account has bedrockDirect 0 and its slice shown", () => {
    const team = computeTeam({
      teamId: "team-gw",
      rollups: teamRollups(),
      gateway: ACCOUNT_FORM,
      litellm: rows(row(5)),
    });
    expect(team.bedrockDirect).toBe(0);
    expect(team.gatewaySlice).toBeCloseTo(5, 6);
    expect(team.combined).toBeCloseTo(5, 6);
  });

  it("gateway principals in the team's own account are excluded from direct and shown as the slice", () => {
    const team = computeTeam({
      teamId: "team-a",
      rollups: principalFormRollups(),
      gateway: PRINCIPAL_FORM,
      litellm: rows(row(5.2)),
    });
    expect(team.bedrockDirect).toBeCloseTo(10, 6);
    expect(team.gatewaySlice).toBeCloseTo(5, 6);
    expect(team.combined).toBeCloseTo(15.2, 6);
    expect(team.costEstimated).toBe(true);
  });

  it("an unlinked team has combined null and reason not-linked; its direct Bedrock is still shown", () => {
    const team = computeTeam({
      teamId: "team-a",
      rollups: teamRollups(),
      gateway: ACCOUNT_FORM,
      litellm: { kind: "not-linked" },
    });
    expect(team.combined).toBeNull();
    expect(team.litellm).toBeNull();
    expect(team.reason).toBe("not-linked");
    expect(team.bedrockDirect).toBeCloseTo(10, 6);
  });

  it("LiteLLM not configured: litellm and combined null, no reason", () => {
    const team = computeTeam({
      teamId: "team-a",
      rollups: teamRollups(),
      gateway: ACCOUNT_FORM,
      litellm: { kind: "not-configured" },
    });
    expect(team.litellm).toBeNull();
    expect(team.combined).toBeNull();
    expect(team).not.toHaveProperty("reason");
  });

  it("a team with no rollups in the range is all zeros", () => {
    const team = computeTeam({
      teamId: "team-none",
      rollups: teamRollups(),
      gateway: NONE,
      litellm: rows(),
    });
    expect(team).toMatchObject({
      bedrockDirect: 0,
      gatewaySlice: 0,
      litellm: 0,
      combined: 0,
    });
  });
});

describe("computePerson (Person P)", () => {
  const keys = new Set([ALICE]);

  it("direct Bedrock of the person's keys outside gateway accounts plus their paged LiteLLM total", () => {
    const person = computePerson({
      rollups: accountFormRollups(),
      gateway: ACCOUNT_FORM,
      usageKeys: keys,
      litellm: rows(row(5.2, { bedrock: 5.2 })),
    });
    expect(person.bedrockDirect).toBeCloseTo(10, 6);
    expect(person.litellm).toBeCloseTo(5.2, 6);
    expect(person.litellmUser).toBe(true);
    expect(person.combined).toBeCloseTo(15.2, 6);
  });

  it("a person's figure always includes estimates (shared contract 5)", () => {
    const person = computePerson({
      rollups: accountFormRollups(),
      gateway: NONE,
      usageKeys: keys,
      litellm: rows(),
    });
    expect(person.costEstimated).toBe(true);
  });

  it("usage in a gateway account is not the person's direct usage, whatever the key", () => {
    const person = computePerson({
      rollups: [
        rollup({
          accountId: GW_ACCT,
          models: { "claude-sonnet": { cost: 4, byUser: { [ALICE]: 4 } } },
        }),
      ],
      gateway: ACCOUNT_FORM,
      usageKeys: keys,
      litellm: rows(),
    });
    expect(person.bedrockDirect).toBe(0);
  });

  it("a key of the person that is also a gateway principal is excluded (¬G(k))", () => {
    const person = computePerson({
      rollups: [
        rollup({
          accountId: SHARED_ACCT,
          models: {
            "claude-sonnet": { cost: 9, byUser: { [ALICE]: 4, "svc-key": 5 } },
          },
        }),
      ],
      gateway: {
        principals: [{ type: "usage-key", value: "svc-key" }],
        accountIds: [],
      },
      usageKeys: new Set([ALICE, "svc-key"]),
      litellm: rows(),
    });
    expect(person.bedrockDirect).toBeCloseTo(4, 6);
  });

  it("sums the person's keys over every model, ignoring other people's", () => {
    const person = computePerson({
      rollups: [
        rollup({
          accountId: SHARED_ACCT,
          models: {
            "claude-sonnet": {
              cost: 9,
              byUser: { [ALICE]: 3, "bob@example.com": 6 },
            },
            "claude-haiku": { cost: 2, byUser: { [ALICE]: 2 } },
          },
        }),
      ],
      gateway: NONE,
      usageKeys: new Set([ALICE, "alice.alt@example.com"]),
      litellm: rows(),
    });
    expect(person.bedrockDirect).toBeCloseTo(5, 6);
  });

  it("canonicalises the stored key before matching (an SSO ARN carrying the email, any case)", () => {
    const person = computePerson({
      rollups: [
        rollup({
          accountId: SHARED_ACCT,
          models: {
            "claude-sonnet": {
              cost: 4,
              byUser: {
                "arn:aws:sts::111122223333:assumed-role/AWSReservedSSO_Dev_abc/Alice@Example.com": 4,
              },
            },
          },
        }),
      ],
      gateway: NONE,
      usageKeys: keys,
      litellm: rows(),
    });
    expect(person.bedrockDirect).toBeCloseTo(4, 6);
  });

  it("no LiteLLM user: litellm 0, litellmUser false, combined is the direct figure", () => {
    const person = computePerson({
      rollups: accountFormRollups(),
      gateway: ACCOUNT_FORM,
      usageKeys: keys,
      litellm: { kind: "no-user" },
    });
    expect(person.litellm).toBe(0);
    expect(person.litellmUser).toBe(false);
    expect(person.combined).toBeCloseTo(10, 6);
  });

  it("LiteLLM not configured: litellm and combined null, direct still shown", () => {
    const person = computePerson({
      rollups: accountFormRollups(),
      gateway: ACCOUNT_FORM,
      usageKeys: keys,
      litellm: { kind: "not-configured" },
    });
    expect(person.bedrockDirect).toBeCloseTo(10, 6);
    expect(person.litellm).toBeNull();
    expect(person.combined).toBeNull();
  });

  it("an unfinalised day makes the figure provisional", () => {
    const [first] = accountFormRollups();
    const person = computePerson({
      rollups: [unfinalised(first!)],
      gateway: NONE,
      usageKeys: keys,
      litellm: rows(),
    });
    expect(person.provisional).toBe(true);
  });

  it("a person with no usage at all is zero, not an error", () => {
    const person = computePerson({
      rollups: [],
      gateway: NONE,
      usageKeys: new Set(),
      litellm: rows(),
    });
    expect(person).toMatchObject({ bedrockDirect: 0, litellm: 0, combined: 0 });
  });
});
