import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { CombinedOrganisationResponseSchema } from "@llm-usage-lens/shared";
import { describe, expect, it, vi } from "vitest";

import { dailyRow } from "@/test/fakes/fake-litellm-combined";
import {
  call,
  expectError,
  setToggles,
  signInWithRoles,
  stubLiteLLMEnv,
} from "@/test/fakes/fake-litellm-views";
import { LTEAM, UNLINKED_LTEAM } from "@/test/fakes/fake-litellm-views";
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
import { TEST_TABLE_NAME, testDoc } from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage (L6)":
// Routes (GET /api/litellm/combined/organisation?dateFrom&dateTo: Admin,
// org-admin, Auditor; else 403), The computation (Organisation: bedrockExact,
// gateway slice, bedrockDirect, litellm = the LD33 teams total over the range
// from getTeamDailySpend with the listed teams, byProvider, reconciliation),
// Visibility (global readers: show when configured, else warn; org-admin is a
// global reader), States (LiteLLM not configured: 200 configured false,
// litellm null, combined null; a needed read off: 403 OPERATION_DISABLED, no
// call; LiteLLM unavailable: 503 LITELLM_UNAVAILABLE), Dates (inclusive UTC
// days, capped at 90, Rule 20.8), LT29, LT32 (Viewer and Lead 403), LD21,
// LD37; Rule 10.3 (403 before input parsing; private, no-store). 401, no-store
// shape and the malformed-query 400 are the route-contract suite's (Rule 60.23).
//
// Contract for the developer (app/api/litellm/combined/organisation/route.ts,
// force-dynamic): GET -> data = CombinedOrganisationResponseSchema. The route
// reads rollups for the range (all accounts), the gateway config
// (getBedrockGateway, once, never cached), and - when LiteLLM is configured -
// listProxyTeams then ONE getTeamDailySpend({ litellmTeamIds: all proxy ids })
// over the range; it needs the toggles listProxyTeams and getTeamDailySpend.
// The pure computation is lib/litellm/combined.ts (computeOrganisation).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupCombinedSuite();
const PATH = "/api/litellm/combined/organisation";

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

// LiteLLM reports $75 over the listed teams: $70 on Bedrock, $5 on OpenAI.
const LITELLM_REPORT = {
  teamDaily: { "*": [dailyRow(75, { bedrock: 70, openai: 5 })] },
};

describe("GET /api/litellm/combined/organisation: who may read (LT32)", () => {
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
    installCombined(state, LITELLM_REPORT);
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

  it("a refused caller gets 403 even with a bad range: the permission check comes before parsing (Rule 10.3)", async () => {
    await as("viewerNone");
    const { res } = await get("dateFrom=nope&dateTo=2026-10-03");
    await expectError(res, 403, "FORBIDDEN");
  });
});

describe("GET /api/litellm/combined/organisation: the figures", () => {
  it("counts the gateway slice once: Bedrock direct + all LiteLLM spend, the slice and the reconciliation shown (gateway account form)", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, LITELLM_REPORT);
    await as("admin");
    const { res, body } = await get();
    expect(res.status).toBe(200);
    const data = CombinedOrganisationResponseSchema.parse(body.data);
    expect(data).toMatchObject({
      visibility: "show",
      configured: true,
      gatewayConfigured: true,
      bedrockExact: 243,
      gatewaySlice: 69,
      bedrockDirect: 174,
      litellm: 75,
      combined: 249,
      byProvider: [
        { provider: "bedrock", spend: 70 },
        { provider: "openai", spend: 5 },
      ],
      costEstimated: false,
      provisional: false,
    });
    expect(data.reconciliation).toMatchObject({
      litellmBedrock: 70,
      difference: -1,
    });
    expect(data.reconciliation?.differencePct).toBeCloseTo(-1 / 69, 5);
  });

  it("totals the LiteLLM teams in one aggregated read over every listed team, unlinked ones included (LD33)", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, LITELLM_REPORT);
    await as("admin");
    await get();
    const reads = callsTo(state, "/team/daily/activity/aggregated");
    expect(reads).toHaveLength(1);
    const ids = new URL(reads[0]!.url).searchParams.get("team_ids")!.split(",");
    expect([...ids].sort()).toEqual(
      [...Object.values(LTEAM), UNLINKED_LTEAM].sort(),
    );
    const q = new URL(reads[0]!.url).searchParams;
    expect(q.get("start_date")).toBe("2026-10-01");
    expect(q.get("end_date")).toBe("2026-10-03");
    expect(q.get("timezone")).toBe("0");
  });

  // Visibility for global readers: show when configured, else warn (org-admin
  // gets the warning, not hiding: LD38).
  describe.each<[Who]>([["admin"], ["orgAdmin"], ["auditor"]])(
    "visibility for %s",
    (who) => {
      it("show when the gateway is configured", async () => {
        await storeGateway({ accountIds: [GW_ACCOUNT_B] });
        installCombined(state, LITELLM_REPORT);
        await as(who);
        const { body } = await get();
        expect(body.data).toMatchObject({
          visibility: "show",
          gatewayConfigured: true,
        });
      });
      it("warn when it is not: the full body with an empty slice, never hidden", async () => {
        installCombined(state, LITELLM_REPORT);
        await as(who);
        const { res, body } = await get();
        expect(res.status).toBe(200);
        const data = CombinedOrganisationResponseSchema.parse(body.data);
        expect(data).toMatchObject({
          visibility: "warn",
          gatewayConfigured: false,
          bedrockExact: 243,
          gatewaySlice: 0,
          bedrockDirect: 243,
          litellm: 75,
          combined: 318,
        });
      });
    },
  );

  it("a configuration with both lists cleared counts as not configured (warn)", async () => {
    await storeGateway({ version: 2 });
    installCombined(state, LITELLM_REPORT);
    await as("admin");
    const { body } = await get();
    expect(body.data).toMatchObject({
      visibility: "warn",
      gatewayConfigured: false,
    });
  });

  it("is read per request: a configuration stored after a first read changes the next answer (LT33)", async () => {
    installCombined(state, LITELLM_REPORT);
    await as("admin");
    expect((await get()).body.data).toMatchObject({ visibility: "warn" });
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    expect((await get()).body.data).toMatchObject({
      visibility: "show",
      gatewaySlice: 69,
    });
  });
});

describe("GET /api/litellm/combined/organisation: states", () => {
  it("LiteLLM not configured (LD37): 200 with Bedrock parts only, litellm and combined null, no LiteLLM call", async () => {
    await testDoc().send(
      new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
      }),
    );
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    await as("admin");
    const { res, body } = await get();
    expect(res.status).toBe(200);
    const data = CombinedOrganisationResponseSchema.parse(body.data);
    expect(data).toMatchObject({
      configured: false,
      bedrockExact: 243,
      gatewaySlice: 69,
      bedrockDirect: 174,
      litellm: null,
      combined: null,
      byProvider: [],
      reconciliation: null,
    });
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each(["listProxyTeams", "getTeamDailySpend"])(
    "%s switched off: 403 OPERATION_DISABLED and no LiteLLM call (LD21)",
    async (operation) => {
      await setToggles({ [operation]: false });
      await as("admin");
      const { res } = await get();
      await expectError(res, 403, "OPERATION_DISABLED");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  // LD37 + LD21 (as /api/litellm/org: requireEnabled first, then not-configured).
  it.each(["listProxyTeams", "getTeamDailySpend"])(
    "%s switched off and LiteLLM not configured: 403 OPERATION_DISABLED, not the empty configured:false view (LD37; LD21)",
    async (operation) => {
      await testDoc().send(
        new DeleteCommand({
          TableName: TEST_TABLE_NAME,
          Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
        }),
      );
      await setToggles({ [operation]: false });
      await as("admin");
      const { res } = await get();
      await expectError(res, 403, "OPERATION_DISABLED");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE", async () => {
    installCombined(state, { outage: true });
    await as("admin");
    const { res } = await get();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
  });

  it.each([
    ["a malformed date", "dateFrom=nope&dateTo=2026-10-03"],
    ["a missing date", "dateFrom=2026-10-01"],
    [
      "a range over 90 days (Rule 20.8)",
      "dateFrom=2026-01-01&dateTo=2026-06-01",
    ],
    ["an inverted range", "dateFrom=2026-10-03&dateTo=2026-10-01"],
  ])(
    "%s is 400 BAD_REQUEST for an allowed caller, no LiteLLM call",
    async (_n, query) => {
      await as("admin");
      const { res } = await get(query);
      await expectError(res, 400, "BAD_REQUEST");
      expect(state.fake.calls).toHaveLength(0);
    },
  );
});
