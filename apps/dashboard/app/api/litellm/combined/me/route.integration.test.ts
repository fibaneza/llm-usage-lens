import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { CombinedMeResponseSchema } from "@llm-usage-lens/shared";
import { describe, expect, it, vi } from "vitest";

import { dailyRow } from "@/test/fakes/fake-litellm-combined";
import {
  LUSER,
  call,
  enterProd,
  expectError,
  setToggles,
  signInWithRoles,
  stubLiteLLMEnv,
} from "@/test/fakes/fake-litellm-views";
import { signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import { send } from "@/test/support/litellm-member-writes-support";
import {
  FIGURE_KEYS,
  GW_ACCOUNT_A,
  GW_ACCOUNT_B,
  RANGE,
  callsTo,
  installCombined,
  setupCombinedSuite,
  storeGateway,
} from "@/test/support/litellm-combined-support";
import { TEST_TABLE_NAME, testDoc } from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage (L6)":
// Routes (GET /api/litellm/combined/me: any signed-in role, own data, never
// capped), The computation (Person P: bedrockDirect over the caller's own
// usage keys outside gateway accounts and gateway principals, model cost only;
// litellm = the paged getUserDailySpend total, 0 with litellmUser false when
// there is none; costEstimated always true), Visibility (global readers:
// show when configured, else warn; everyone else: show when configured, else
// hidden, applied by the server, with no combined, slice or reconciliation
// field), States (LD37; OPERATION_DISABLED; 503), LiteLLM reads used (paging),
// Dates, LT29, LT31 (own figure only; never capped), LT32, LT33 (a write is
// reflected on the next request), shared contract 5 (unconfigured gateway:
// warn Admins and Auditors, hide from Viewers and Leads), Views by role (own
// usage: the LiteLLM user through the identity link, else by email).
//
// Contract for the developer (app/api/litellm/combined/me/route.ts,
// force-dynamic): GET -> data = CombinedMeResponseSchema. The caller's keys are
// lib/api/me.ts ownUsageKeys (identity-link usage identities + the session
// email); the LiteLLM user is the identity link's litellmUserId, else
// findUserByEmail on the session email (best effort, as /api/litellm/me); the
// toggle getUserDailySpend is needed only when a LiteLLM user exists.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupCombinedSuite();
const PATH = "/api/litellm/combined/me";

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

// memberA's LiteLLM spend arrives on two pages: 4 + 2.
const TWO_PAGES = {
  userPages: [[dailyRow(4, { bedrock: 4 })], [dailyRow(2, { bedrock: 2 })]],
};

describe("GET /api/litellm/combined/me: role x visibility (shared contract 5; LT29, LT32)", () => {
  // Complete matrix (security, Rule 60.24a): [caller, gateway configured] -> visibility.
  const MATRIX: Array<
    [Who, "show" | "warn" | "hidden", "show" | "warn" | "hidden"]
  > = [
    // caller,        configured, not configured
    ["admin", "show", "warn"],
    ["orgAdmin", "show", "warn"],
    ["auditor", "show", "warn"],
    ["teamAdminA", "show", "hidden"],
    ["deptAdminEng", "show", "hidden"],
    ["memberA", "show", "hidden"],
    ["viewerNone", "show", "hidden"],
    ["noRole", "show", "hidden"],
  ];

  it.each(MATRIX)(
    "%s: %s when the gateway is configured",
    async (who, expected) => {
      await storeGateway({ accountIds: [GW_ACCOUNT_B] });
      installCombined(state, TWO_PAGES);
      await as(who);
      const { res, body } = await get();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(CombinedMeResponseSchema.parse(body.data)).toMatchObject({
        visibility: expected,
        gatewayConfigured: true,
      });
    },
  );

  it.each(MATRIX)(
    "%s: (configured) -> %s, gateway not configured -> hidden or warn",
    async (who, _c, expected) => {
      installCombined(state, TWO_PAGES);
      await as(who);
      const { res, body, text } = await get();
      expect(res.status).toBe(200);
      expect(CombinedMeResponseSchema.parse(body.data).visibility).toBe(
        expected,
      );
      expect(body.data.gatewayConfigured).toBe(false);
      if (expected === "hidden") {
        // The server hides it: nothing to unhide client-side (LT29, LT32).
        expect(Object.keys(body.data).sort()).toEqual([
          "configured",
          "gatewayConfigured",
          "visibility",
        ]);
        for (const key of FIGURE_KEYS) expect(text).not.toContain(`"${key}"`);
      } else {
        expect(typeof body.data.bedrockDirect).toBe("number");
      }
    },
  );

  it("a configuration with both lists cleared hides the figure from a Viewer like no configuration", async () => {
    await storeGateway({ version: 2 });
    await as("viewerNone");
    const { body } = await get();
    expect(body.data.visibility).toBe("hidden");
  });

  it("a write is reflected on the next request: Admin saves the gateway, the Viewer's answer turns from hidden to show (LT33)", async () => {
    installCombined(state, TWO_PAGES);
    await as("viewerNone");
    expect((await get()).body.data.visibility).toBe("hidden");
    await as("admin");
    stubLiteLLMEnv();
    const { PUT } = await import("../../gateway/route");
    const saved = await send(PUT, {
      method: "PUT",
      path: "/api/litellm/gateway",
      params: {},
      body: {
        version: null,
        principals: [{ type: "iam-role", value: "litellm-bedrock" }],
        accountIds: [],
      },
    });
    expect(saved.res.status).toBe(200);
    await as("viewerNone");
    expect((await get()).body.data.visibility).toBe("show");
  });
});

describe("GET /api/litellm/combined/me: the figure", () => {
  it("own Bedrock usage across both usage keys outside the gateway account, plus the paged LiteLLM total", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, TWO_PAGES);
    await as("memberA");
    const { body } = await get();
    const data = CombinedMeResponseSchema.parse(body.data);
    // a1 7 x 3 days in account 1 + the second key's 2 in account 5; a2's 12 is not theirs.
    expect(data).toMatchObject({
      visibility: "show",
      configured: true,
      gatewayConfigured: true,
      bedrockDirect: 23,
      litellm: 6,
      litellmUser: true,
      combined: 29,
      costEstimated: true,
      provisional: false,
    });
  });

  it("usage in a gateway account is not direct usage", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_A] });
    installCombined(state, TWO_PAGES);
    await as("memberA");
    const { body } = await get();
    expect(body.data).toMatchObject({
      bedrockDirect: 2,
      litellm: 6,
      combined: 8,
    });
  });

  // LT32 (L6 review Q1): /me is own keys only for every role; a Lead's team
  // spend (team-a, 33 over the range) never enters their figure.
  it("a Lead's figure is their own usage keys only, never their team's or scope's spend (LT32)", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, TWO_PAGES);
    await as("teamAdminA");
    const { body, text } = await get();
    expect(body.data.bedrockDirect).toBe(0);
    expect(text).not.toContain("33");
    expect(text).not.toContain("a1@company.com");
  });

  it("loops the LiteLLM read on has_more: page_size 1000, pages 1 and 2, the same UTC days (LT34; LD20)", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, TWO_PAGES);
    await as("memberA");
    await get();
    const reads = callsTo(state, "/user/daily/activity").map(
      (c) => new URL(c.url).searchParams,
    );
    expect(reads).toHaveLength(2);
    expect(reads.map((q) => q.get("page"))).toEqual(["1", "2"]);
    for (const q of reads) {
      expect(q.get("user_id")).toBe(LUSER.memberA);
      expect(q.get("page_size")).toBe("1000");
      expect(q.get("start_date")).toBe("2026-10-01");
      expect(q.get("end_date")).toBe("2026-10-03");
      expect(q.get("timezone")).toBe("0");
    }
  });

  it("a caller with no LiteLLM user: litellm 0, litellmUser false, combined is the direct figure, no daily read", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    await as("viewerNone");
    const { body } = await get();
    expect(body.data).toMatchObject({
      visibility: "show",
      bedrockDirect: 0,
      litellm: 0,
      litellmUser: false,
      combined: 0,
      costEstimated: true,
    });
    expect(callsTo(state, "/user/daily/activity")).toHaveLength(0);
  });

  it("an unlinked caller's LiteLLM user is found by session email and read under the id LiteLLM returns", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, { userPages: [[dailyRow(1.5, { bedrock: 1.5 })]] });
    await as("teamAdminA");
    const { body } = await get();
    expect(body.data).toMatchObject({ litellmUser: true, litellm: 1.5 });
    const read = callsTo(state, "/user/daily/activity")[0]!;
    expect(new URL(read.url).searchParams.get("user_id")).toBe("uid-ta-0001");
  });
});

describe("GET /api/litellm/combined/me: states", () => {
  it("LiteLLM not configured (LD37): 200 with the Bedrock part only, litellm and combined null, no LiteLLM call", async () => {
    await testDoc().send(
      new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
      }),
    );
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    await as("memberA");
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(CombinedMeResponseSchema.parse(body.data)).toMatchObject({
      visibility: "show",
      configured: false,
      bedrockDirect: 23,
      litellm: null,
      combined: null,
    });
    expect(state.fake.calls).toHaveLength(0);
  });

  it("getUserDailySpend switched off: 403 OPERATION_DISABLED and no daily read (LD21)", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    await setToggles({ getUserDailySpend: false });
    await as("memberA");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(callsTo(state, "/user/daily/activity")).toHaveLength(0);
  });

  // LD37 + LD21 (as /api/litellm/org: requireEnabled first, then not-configured).
  it("getUserDailySpend switched off and LiteLLM not configured: 403 OPERATION_DISABLED, not the Bedrock-only body (LD37; LD21)", async () => {
    await testDoc().send(
      new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
      }),
    );
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    await setToggles({ getUserDailySpend: false });
    await as("memberA");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, { outage: true });
    await as("memberA");
    const { res } = await get();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
  });

  it("more than 10 pages is 503 LITELLM_UNAVAILABLE, never a partial sum (LT34)", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, { endlessUserPages: true });
    await as("memberA");
    const { res } = await get();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(callsTo(state, "/user/daily/activity")).toHaveLength(10);
  });

  it("is never capped: under the Organisation cap (prod, no approval) the caller still gets their own figure (LT31)", async () => {
    await enterProd();
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    installCombined(state, TWO_PAGES);
    await as("memberA");
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      bedrockDirect: 23,
      litellm: 6,
      combined: 29,
    });
  });

  it.each([
    ["a malformed date", "dateFrom=nope&dateTo=2026-10-03"],
    [
      "a range over 90 days (Rule 20.8)",
      "dateFrom=2026-01-01&dateTo=2026-06-01",
    ],
  ])(
    "%s is 400 BAD_REQUEST for any signed-in role, no LiteLLM call",
    async (_n, query) => {
      await as("viewerNone");
      const { res } = await get(query);
      await expectError(res, 400, "BAD_REQUEST");
      expect(state.fake.calls).toHaveLength(0);
    },
  );
});
