import { describe, expect, it } from "vitest";

import {
  CombinedMeResponseSchema,
  CombinedOrganisationResponseSchema,
  CombinedTeamResponseSchema,
  CombinedTeamsResponseSchema,
  CombinedVisibilitySchema,
} from "../index";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage (L6)"
// (The computation: organisation, team, person figures, reconciliation,
// estimates and provisional flags; Visibility: show | warn | hidden, and a
// hidden body carries no combined, slice or reconciliation field; States:
// LiteLLM not configured -> configured false, litellm null, combined null;
// Routes), LD38, LT29-LT32 (a Viewer or Lead never sees combined or slice
// figures when the gateway is not configured); Rule 60.22 (valid + invalid).
//
// Contract for the developer (packages/shared/src/schemas/combined.ts,
// re-exported from index.ts). All four responses share the head
// { visibility, configured, gatewayConfigured }:
//   - visibility "show"  -> gatewayConfigured true; "warn" -> false (the full
//     body, an Admin / org-admin / Auditor sees it with the warning);
//   - visibility "hidden" -> exactly { visibility, configured,
//     gatewayConfigured: false }, a strict object: no figures at all.
// `configured` is the LiteLLM connection (LD37), not the gateway.

const head = { visibility: "show", configured: true, gatewayConfigured: true };
const hidden = {
  visibility: "hidden",
  configured: true,
  gatewayConfigured: false,
};

const org = {
  ...head,
  bedrockExact: 15,
  gatewaySlice: 5,
  bedrockDirect: 10,
  litellm: 6.2,
  combined: 16.2,
  byProvider: [
    { provider: "bedrock", spend: 5.2 },
    { provider: "openai", spend: 1 },
  ],
  reconciliation: {
    litellmBedrock: 5.2,
    difference: -0.2,
    differencePct: -0.04,
  },
  costEstimated: false,
  provisional: false,
};
const teamFigure = {
  teamId: "team-a",
  teamName: "A",
  bedrockDirect: 33,
  gatewaySlice: 0,
  litellm: 10,
  combined: 43,
  costEstimated: false,
  provisional: false,
};
const me = {
  ...head,
  bedrockDirect: 23,
  litellm: 6,
  litellmUser: true,
  combined: 29,
  costEstimated: true,
  provisional: false,
};

describe("CombinedVisibilitySchema", () => {
  it.each(["show", "warn", "hidden"])("accepts %s", (v) =>
    expect(CombinedVisibilitySchema.safeParse(v).success).toBe(true),
  );
  it.each(["none", "SHOW", "", 1])("rejects %j", (v) =>
    expect(CombinedVisibilitySchema.safeParse(v).success).toBe(false),
  );
});

describe.each([
  ["organisation", CombinedOrganisationResponseSchema, org],
  ["teams", CombinedTeamsResponseSchema, { ...head, teams: [teamFigure] }],
  ["team", CombinedTeamResponseSchema, { ...head, ...teamFigure }],
  ["me", CombinedMeResponseSchema, me],
] as const)("the %s response", (_name, schema, full) => {
  it("accepts a full body for show", () => {
    expect(schema.safeParse(full).success).toBe(true);
  });

  it("accepts a full body for warn (gateway not configured)", () => {
    expect(
      schema.safeParse({
        ...full,
        visibility: "warn",
        gatewayConfigured: false,
      }).success,
    ).toBe(true);
  });

  it("accepts the hidden body", () => {
    expect(schema.parse(hidden)).toEqual(hidden);
  });

  it.each([
    ["combined", { combined: 1 }],
    ["a slice", { gatewaySlice: 1 }],
    [
      "a reconciliation",
      {
        reconciliation: {
          litellmBedrock: 0,
          difference: 0,
          differencePct: null,
        },
      },
    ],
    ["bedrockDirect", { bedrockDirect: 1 }],
    ["teams", { teams: [] }],
  ])("rejects a hidden body that carries %s (LT29, LT32)", (_n, extra) => {
    expect(schema.safeParse({ ...hidden, ...extra }).success).toBe(false);
  });

  it("rejects a hidden body whose gatewayConfigured is true", () => {
    expect(
      schema.safeParse({ ...hidden, gatewayConfigured: true }).success,
    ).toBe(false);
  });

  it("rejects show with an unconfigured gateway", () => {
    expect(
      schema.safeParse({ ...full, gatewayConfigured: false }).success,
    ).toBe(false);
  });

  it("rejects an unknown visibility and an unknown field", () => {
    expect(schema.safeParse({ ...full, visibility: "maybe" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...full, extra: 1 }).success).toBe(false);
  });
});

describe("the organisation figure", () => {
  it("accepts the LiteLLM-not-configured state: litellm, combined and reconciliation null (LD37)", () => {
    expect(
      CombinedOrganisationResponseSchema.safeParse({
        ...org,
        configured: false,
        litellm: null,
        combined: null,
        byProvider: [],
        reconciliation: null,
      }).success,
    ).toBe(true);
  });
  it("accepts a null differencePct (slice 0)", () => {
    expect(
      CombinedOrganisationResponseSchema.safeParse({
        ...org,
        reconciliation: {
          litellmBedrock: 1,
          difference: -1,
          differencePct: null,
        },
      }).success,
    ).toBe(true);
  });
  it.each([
    "bedrockExact",
    "gatewaySlice",
    "bedrockDirect",
    "byProvider",
    "costEstimated",
    "provisional",
  ])("requires %s", (field) => {
    const rest = Object.fromEntries(
      Object.entries(org).filter(([k]) => k !== field),
    );
    expect(CombinedOrganisationResponseSchema.safeParse(rest).success).toBe(
      false,
    );
  });
  it("rejects a non-finite figure", () => {
    expect(
      CombinedOrganisationResponseSchema.safeParse({
        ...org,
        combined: Number.NaN,
      }).success,
    ).toBe(false);
  });
});

describe("the team figure", () => {
  it("accepts an unlinked team: combined and litellm null with reason not-linked", () => {
    expect(
      CombinedTeamResponseSchema.safeParse({
        ...head,
        ...teamFigure,
        litellm: null,
        combined: null,
        reason: "not-linked",
      }).success,
    ).toBe(true);
  });
  it("rejects any other reason", () => {
    expect(
      CombinedTeamResponseSchema.safeParse({
        ...head,
        ...teamFigure,
        reason: "because",
      }).success,
    ).toBe(false);
  });
});

describe("the person figure", () => {
  it("always carries costEstimated: true (shared contract 5: a person's figure includes estimates)", () => {
    expect(
      CombinedMeResponseSchema.safeParse({ ...me, costEstimated: false })
        .success,
    ).toBe(false);
  });
  it("accepts a person with no LiteLLM user: litellm 0, litellmUser false", () => {
    expect(
      CombinedMeResponseSchema.safeParse({
        ...me,
        litellm: 0,
        litellmUser: false,
        combined: 23,
      }).success,
    ).toBe(true);
  });
  it("accepts the LiteLLM-not-configured state: litellm and combined null", () => {
    expect(
      CombinedMeResponseSchema.safeParse({
        ...me,
        configured: false,
        litellm: null,
        combined: null,
      }).success,
    ).toBe(true);
  });
});
