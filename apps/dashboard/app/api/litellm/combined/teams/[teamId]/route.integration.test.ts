import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { CombinedTeamResponseSchema } from "@llm-usage-lens/shared";
import { describe, expect, it, vi } from "vitest";

import { dailyRow } from "@/test/fakes/fake-litellm-combined";
import {
  LTEAM,
  call,
  expectError,
  setToggles,
  signInWithRoles,
  stubLiteLLMEnv,
} from "@/test/fakes/fake-litellm-views";
import { signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import {
  FIGURE_KEYS,
  GW_ACCOUNT_B,
  RANGE,
  installCombined,
  setupCombinedSuite,
  storeGateway,
} from "@/test/support/litellm-combined-support";
import { TEST_TABLE_NAME, testDoc } from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage (L6)":
// Routes (GET /api/litellm/combined/teams/[teamId]: Admin, org-admin, Auditor;
// "else the missing-team 404 (parity)"), The computation (Team T), States,
// LT32 ("Matrix: Lead and Viewer 403/404"), Access Control - Enforcement item
// 2 (an out-of-scope detail returns the same 404 body as a missing one).
//
// Contract for the developer (app/api/litellm/combined/teams/[teamId]/route.ts,
// force-dynamic): GET -> data = CombinedTeamResponseSchema { visibility,
// configured, gatewayConfigured, teamId, teamName, bedrockDirect,
// gatewaySlice, litellm, combined, reason?, costEstimated, provisional }.
// Non-global-readers and unknown teams get the SAME 404 NOT_FOUND body (a
// Lead's own team is not an exception: Leads have no AWS cost pages). A team
// that exists but has no rollup in the range is all zeros, not 404.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupCombinedSuite();

type Who = CallerName | "noRole";
const as = async (who: Who) => {
  if (who === "noRole") await signInWithRoles([]);
  else signInAs(who);
};
const get = async (teamId: string, query = RANGE) => {
  stubLiteLLMEnv();
  const { GET } = await import("./route");
  return call(GET, `/api/litellm/combined/teams/${teamId}?${query}`, {
    teamId,
  });
};

const PER_TEAM = {
  teamDaily: {
    [LTEAM["team-a"]]: [dailyRow(10, { bedrock: 10 })],
    [LTEAM["team-b"]]: [dailyRow(20, { bedrock: 20 })],
    "*": [],
  },
};

describe("GET /api/litellm/combined/teams/[teamId]: who may read (LT32)", () => {
  it.each<[Who, 200 | 404]>([
    ["admin", 200],
    ["orgAdmin", 200],
    ["auditor", 200],
    ["teamAdminA", 404],
    ["deptAdminEng", 404],
    ["memberA", 404],
    ["viewerNone", 404],
    ["noRole", 404],
  ])("%s on team-a -> %i", async (who, status) => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, PER_TEAM);
    await as(who);
    const { res, text } = await get("team-a");
    expect(res.status).toBe(status);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    if (status === 404) {
      await expectError(res, 404, "NOT_FOUND");
      expect(state.fake.calls).toHaveLength(0);
      for (const key of FIGURE_KEYS) expect(text).not.toContain(`"${key}"`);
    }
  });

  it("a refused caller's 404 is byte-identical to a missing team's 404 (parity; nothing says the team exists)", async () => {
    await as("teamAdminA");
    const refused = await get("team-a");
    await as("admin");
    const missing = await get("no-such-team");
    expect(missing.res.status).toBe(404);
    expect(refused.text).toBe(missing.text);
  });
});

describe("GET /api/litellm/combined/teams/[teamId]: the figure", () => {
  it("a linked team: direct Bedrock + the linked LiteLLM team's spend", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, PER_TEAM);
    await as("admin");
    const { body } = await get("team-a");
    const data = CombinedTeamResponseSchema.parse(body.data);
    expect(data).toMatchObject({
      visibility: "show",
      teamId: "team-a",
      teamName: "A",
      bedrockDirect: 33,
      gatewaySlice: 0,
      litellm: 10,
      combined: 43,
    });
    expect(data).not.toHaveProperty("reason");
  });

  it("a team whose account is the gateway account: bedrockDirect 0, its slice shown", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, PER_TEAM);
    await as("auditor");
    const { body } = await get("team-b");
    expect(body.data).toMatchObject({
      bedrockDirect: 0,
      gatewaySlice: 69,
      litellm: 20,
      combined: 20,
    });
  });

  it("an unlinked team: combined null, reason not-linked, no LiteLLM call", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    await as("admin");
    const { body } = await get("team-u");
    expect(body.data).toMatchObject({
      teamId: "team-u",
      bedrockDirect: 3,
      litellm: null,
      combined: null,
      reason: "not-linked",
    });
    expect(state.fake.calls).toHaveLength(0);
  });

  it("gateway not configured: warn for an org-admin, the figures unchanged by any slice", async () => {
    installCombined(state, PER_TEAM);
    await as("orgAdmin");
    const { body } = await get("team-b");
    expect(body.data).toMatchObject({
      visibility: "warn",
      gatewayConfigured: false,
      bedrockDirect: 69,
      gatewaySlice: 0,
      combined: 89,
    });
  });

  it("getTeamDailySpend switched off: 403 OPERATION_DISABLED, no call (LD21)", async () => {
    await setToggles({ getTeamDailySpend: false });
    await as("admin");
    const { res } = await get("team-a");
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  // LD37 + LD21 (as /api/litellm/org: requireEnabled first, then not-configured).
  it("getTeamDailySpend switched off and LiteLLM not configured: 403 OPERATION_DISABLED, not the Bedrock-only body (LD37; LD21)", async () => {
    await testDoc().send(
      new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
      }),
    );
    await setToggles({ getTeamDailySpend: false });
    await as("admin");
    const { res } = await get("team-a");
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE", async () => {
    installCombined(state, { outage: true });
    await as("admin");
    const { res } = await get("team-a");
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
  });

  it("a malformed team id is 400 BAD_REQUEST for an allowed caller; a bad range too", async () => {
    await as("admin");
    await expectError((await get("x".repeat(200))).res, 400, "BAD_REQUEST");
    await expectError(
      (await get("team-a", "dateFrom=2026-01-01&dateTo=2026-06-01")).res,
      400,
      "BAD_REQUEST",
    );
  });
});
