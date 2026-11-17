import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { CombinedTeamsResponseSchema } from "@llm-usage-lens/shared";
import { describe, expect, it, vi } from "vitest";

import { combinedHandler, dailyRow } from "@/test/fakes/fake-litellm-combined";
import {
  LTEAM,
  UNLINKED_LTEAM,
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
  callsTo,
  installCombined,
  setupCombinedSuite,
  storeGateway,
} from "@/test/support/litellm-combined-support";
import { holdFetch, macrotask, trackSettled } from "@/test/support/fetch-hold";
import { TEST_TABLE_NAME, testDoc } from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage (L6)":
// Routes (GET /api/litellm/combined/teams?dateFrom&dateTo: Admin, org-admin,
// Auditor; "a row per team in R, combined only on linked teams"), The
// computation (Team T: bedrockDirect over the team's rollups excluding the
// slice, litellm = the linked team's spend via getTeamDailySpend (LD36); an
// unlinked team has combined null, reason "not-linked"; a gateway-account team
// has bedrockDirect 0 and its slice shown), Visibility, States (LD37 / LD21 /
// 503), "Leads and Viewers have no AWS cost pages ... so the team and
// organisation combined routes serve global readers only" (LT32); Rule 10.3.
//
// Contract for the developer (app/api/litellm/combined/teams/route.ts,
// force-dynamic): GET -> data = CombinedTeamsResponseSchema { visibility,
// configured, gatewayConfigured, teams: [{ teamId, teamName, bedrockDirect,
// gatewaySlice, litellm, combined, reason?, costEstimated, provisional }] },
// one row per team with at least one rollup in the range; one
// getTeamDailySpend({ litellmTeamId }) per LINKED team in the range and none
// for an unlinked one; needs the toggle getTeamDailySpend.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupCombinedSuite();
const PATH = "/api/litellm/combined/teams";

type Who = CallerName | "noRole";
const as = async (who: Who) => {
  if (who === "noRole") await signInWithRoles([]);
  else signInAs(who);
};
const get = async (query = RANGE) => {
  stubLiteLLMEnv();
  const { GET } = await import("./route");
  return call(GET, `${PATH}?${query}`);
};

// LiteLLM spend per linked team; team-c and team-m report nothing.
const PER_TEAM = {
  teamDaily: {
    [LTEAM["team-a"]]: [dailyRow(10, { bedrock: 10 })],
    [LTEAM["team-b"]]: [dailyRow(20, { bedrock: 20 })],
    "*": [],
  },
};

describe("GET /api/litellm/combined/teams: who may read (LT32)", () => {
  it.each<[Who, 200 | 403]>([
    ["admin", 200],
    ["orgAdmin", 200],
    ["auditor", 200],
    ["teamAdminA", 403],
    ["deptAdminEng", 403],
    ["memberA", 403],
    ["viewerNone", 403],
    ["noRole", 403],
  ])("%s -> %i", async (who, status) => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, PER_TEAM);
    await as(who);
    const { res, text } = await get();
    expect(res.status).toBe(status);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    if (status === 403) {
      await expectError(res, 403, "FORBIDDEN");
      expect(state.fake.calls).toHaveLength(0);
      for (const key of FIGURE_KEYS) expect(text).not.toContain(`"${key}"`);
    }
  });
});

describe("GET /api/litellm/combined/teams: the rows", () => {
  it("returns a row per team in the range, combined only on linked teams, the gateway-account team's slice shown", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, PER_TEAM);
    await as("admin");
    const { res, body } = await get();
    expect(res.status).toBe(200);
    const data = CombinedTeamsResponseSchema.parse(body.data);
    expect(data).toMatchObject({
      visibility: "show",
      configured: true,
      gatewayConfigured: true,
    });
    if (data.visibility === "hidden")
      throw new Error("global readers are never hidden");
    const rows = [...data.teams].sort((a, b) =>
      a.teamId.localeCompare(b.teamId),
    );
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.teamId === "team-a")).toMatchObject({
      teamName: "A",
      bedrockDirect: 33,
      gatewaySlice: 0,
      litellm: 10,
      combined: 43,
    });
    expect(rows.find((r) => r.teamId === "team-b")).toMatchObject({
      bedrockDirect: 0,
      gatewaySlice: 69,
      litellm: 20,
      combined: 20,
    });
    expect(rows.find((r) => r.teamId === "team-c")).toMatchObject({
      bedrockDirect: 123,
      litellm: 0,
      combined: 123,
    });
    expect(rows.find((r) => r.teamId === "team-m")).toMatchObject({
      bedrockDirect: 15,
      combined: 15,
    });
    const unlinked = rows.find((r) => r.teamId === "team-u");
    expect(unlinked).toMatchObject({
      bedrockDirect: 3,
      litellm: null,
      combined: null,
      reason: "not-linked",
    });
  });

  it("reads LiteLLM once per linked team and never for an unlinked team", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, PER_TEAM);
    await as("admin");
    await get();
    const asked = callsTo(state, "/team/daily/activity/aggregated").map((c) =>
      new URL(c.url).searchParams.get("team_ids"),
    );
    expect([...asked].sort()).toEqual([...Object.values(LTEAM)].sort());
    expect(asked).not.toContain(UNLINKED_LTEAM);
  });

  it.each<[Who]>([["admin"], ["orgAdmin"], ["auditor"]])(
    "%s: warn when the gateway is not configured, with nothing subtracted",
    async (who) => {
      installCombined(state, PER_TEAM);
      await as(who);
      const { body } = await get();
      expect(body.data).toMatchObject({
        visibility: "warn",
        gatewayConfigured: false,
      });
      const b = (body.data.teams as Array<Record<string, unknown>>).find(
        (r) => r.teamId === "team-b",
      );
      expect(b).toMatchObject({
        bedrockDirect: 69,
        gatewaySlice: 0,
        combined: 89,
      });
    },
  );
});

describe("GET /api/litellm/combined/teams: states", () => {
  it("LiteLLM not configured (LD37): Bedrock parts only, litellm and combined null on every row, no LiteLLM call", async () => {
    await testDoc().send(
      new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
      }),
    );
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    await as("admin");
    const { body } = await get();
    expect(body.data.configured).toBe(false);
    for (const row of body.data.teams as Array<Record<string, unknown>>) {
      expect(row.litellm).toBeNull();
      expect(row.combined).toBeNull();
      expect(typeof row.bedrockDirect).toBe("number");
    }
    expect(state.fake.calls).toHaveLength(0);
  });

  it("getTeamDailySpend switched off: 403 OPERATION_DISABLED and no LiteLLM call (LD21)", async () => {
    await setToggles({ getTeamDailySpend: false });
    await as("admin");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  // LD37 + LD21 (as /api/litellm/org: requireEnabled first, then not-configured).
  it("getTeamDailySpend switched off and LiteLLM not configured: 403 OPERATION_DISABLED, not the configured:false view (LD37; LD21)", async () => {
    await testDoc().send(
      new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
      }),
    );
    await setToggles({ getTeamDailySpend: false });
    await as("admin");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE", async () => {
    installCombined(state, { outage: true });
    await as("admin");
    const { res } = await get();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
  });

  // LT25 (amended 2026-11-17) / LD34: a failed team read is 503 only after the
  // other in-flight team reads settled, and nothing is read after the response.
  it("one linked team's failed read is 503 once the in-flight read settled, with no call after (LT25; LD34)", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    const base = combinedHandler(PER_TEAM);
    state.fake.setHandler((callInfo, attempt) =>
      new URL(callInfo.url).searchParams.get("team_ids") === LTEAM["team-a"]
        ? { status: 404, body: { detail: "team not found" } }
        : base(callInfo, attempt),
    );
    const teamRead = (id: string) => (u: URL) =>
      u.pathname === "/team/daily/activity/aggregated" &&
      u.searchParams.get("team_ids") === id;
    const failing = holdFetch(teamRead(LTEAM["team-a"]));
    const inFlight = holdFetch(teamRead(LTEAM["team-b"]));
    await as("admin");
    const request = get();
    const answered = trackSettled(request);
    await Promise.all([failing.arrived, inFlight.arrived]);
    failing.release();
    await failing.settled;
    await macrotask();
    expect(answered()).toBe(false);
    inFlight.release();
    const { res } = await request;
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    const atResponse = state.fake.calls.length;
    await macrotask();
    await macrotask();
    expect(state.fake.calls).toHaveLength(atResponse);
  });

  it("a range over 90 days is 400 BAD_REQUEST (Rule 20.8)", async () => {
    await as("admin");
    const { res } = await get("dateFrom=2026-01-01&dateTo=2026-06-01");
    await expectError(res, 400, "BAD_REQUEST");
  });
});
