import { CombinedMeResponseSchema } from "@llm-usage-lens/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dailyRow } from "@/test/fakes/fake-litellm-combined";

import {
  DATES,
  GHOST_USER_ID,
  LUSER,
  enterProd,
  call,
  expectError,
  expectNoSentinels,
  installFake,
  setToggles,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
  useEnv,
} from "@/test/fakes/fake-litellm-views";
import {
  getIdentityLink,
  putIdentityLink,
} from "@/lib/data/access/identity-links";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";
import { ctxAt, ok } from "@/test/support/access-test-support";
import {
  ALT_KEY,
  FIGURE_KEYS,
  GW_ACCOUNT_B,
  RANGE,
  installCombined,
  seedCombinedExtras,
  storeGateway,
} from "@/test/support/litellm-combined-support";
import type { CallerName } from "@/test/fixtures/scope-fixtures";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/users/
// [litellmUserId] GET: Lead for a member of a team in scope, org-admin, Admin,
// Auditor; otherwise 404), "Views by role (L3b)" (Users tab: spend, budget,
// daily spend via getUser + getUserDailySpend; Scope: out of scope is the same
// 404 as missing), "Reads" (getUser user_id required; getUserDailySpend
// timezone=0, LD20), LT21, LD22, Access Control "Enforcement" item 2, LD19,
// Rules 10.3, 60.23.
//
// Contract for the developer (.../users/[litellmUserId]/route.ts, GET):
//   path: litellmUserId (a LiteLLM user id; a malformed id -> 400 BAD_REQUEST
//   after the role check, no LiteLLM call). query: dateFrom, dateTo (90-day cap).
//   200 data = { userId, email, spend, maxBudget,
//                daily: [{ date, spend, ... }], enabledOperations: string[] }
//   No keys, no teams from LiteLLM, no ids of LiteLLM teams in the body.
//   Membership for a Lead = getUser's `teams` intersected with the LiteLLM ids
//   linked to teams in the Lead's scope. Out of scope, missing (upstream 404),
//   Viewer and no role: the SAME 404 NOT_FOUND body. A Lead's refused read
//   makes no getUserDailySpend call; a Viewer / no-role caller makes no
//   LiteLLM call at all.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupViewsSuite();
// stubLiteLLMEnv resets modules on every request, so the client must be taken
// from the registry the route is about to load: `get` calls `afterReset` once
// the registry is fresh. Records the input of every command sent to DynamoDB;
// `stop` clears the hook.
let afterReset: (() => Promise<void>) | null = null;
const watchDynamo = () => {
  const inputs: string[] = [];
  afterReset = async () => {
    const { getDocumentClient } = await import("@/lib/dynamodb");
    const client = getDocumentClient();
    const original = client.send.bind(client) as (...a: unknown[]) => unknown;
    (client as { send: unknown }).send = (
      command: { input?: unknown },
      ...rest: unknown[]
    ) => {
      inputs.push(JSON.stringify(command.input ?? {}));
      return original(command, ...rest);
    };
  };
  return {
    reads: () => inputs.join("\n"),
    stop: () => {
      afterReset = null;
    },
  };
};
const get = async (userId: string, query = `?${DATES}`) => {
  stubLiteLLMEnv();
  await afterReset?.();
  const { GET } = await import("./route");
  return call(GET, `/api/litellm/users/${encodeURIComponent(userId)}${query}`, {
    litellmUserId: userId,
  });
};
const dailyCalls = () =>
  state.fake.calls.filter((c) => c.path === "/user/daily/activity");

type Who = CallerName | "noRole";
const as = async (who: Who) => {
  if (who === "noRole") await signInWithRoles([]);
  else signInAs(who);
};

describe("GET /api/litellm/users/[litellmUserId]", () => {
  it("401 without a session, no-store (Rule 10.3)", async () => {
    signInAs(null);
    const { res } = await get("a1@company.com");
    await expectError(res, 401, "UNAUTHORIZED");
    expect(state.fake.calls).toHaveLength(0);
  });

  // [caller, target user, status] (complete matrix: security, Rule 60.24a)
  const MATRIX: Array<[Who, string, 200 | 404]> = [
    ["memberA", "a1@company.com", 404],
    ["viewerNone", "a1@company.com", 404],
    ["noRole", "a1@company.com", 404],
    ["teamAdminA", "a1@company.com", 200],
    ["teamAdminA", "ab@company.com", 200],
    ["teamAdminA", "mix@company.com", 200], // member of team-a and team-c
    ["teamAdminA", "b1@company.com", 404],
    ["teamAdminA", "c1@company.com", 404],
    ["teamAdminA", "lone@company.com", 404], // no team at all
    ["deptAdminEng", "a1@company.com", 200],
    ["deptAdminEng", "b1@company.com", 200],
    ["deptAdminEng", "c1@company.com", 404],
    ["deptAdminEng", "lone@company.com", 404],
    ["orgAdmin", "c1@company.com", 200],
    ["orgAdmin", "lone@company.com", 200],
    ["auditor", "c1@company.com", 200],
    ["auditor", "lone@company.com", 200],
    ["admin", "c1@company.com", 200],
    ["admin", "lone@company.com", 200],
  ];
  it.each(MATRIX)(
    "%s reading %s is %i (LT21; Enforcement 2)",
    async (who, user, status) => {
      await as(who);
      const { res, body } = await get(user);
      expect(res.status).toBe(status);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      if (status === 404) {
        expect(body.error.code).toBe("NOT_FOUND");
        expect(dailyCalls()).toHaveLength(0);
      } else {
        expect(body.data.userId).toBe(user);
      }
    },
  );

  it("a Viewer or no-role caller makes no LiteLLM call at all (LT21)", async () => {
    await as("memberA");
    await get("a1@company.com");
    await as("noRole");
    await get("a1@company.com");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("an out-of-scope user answers the same 404 body as a missing user and as a Viewer (Enforcement 2; LT21)", async () => {
    signInAs("teamAdminA");
    const outOfScope = await get("c1@company.com");
    const missing = await get(GHOST_USER_ID);
    await as("memberA");
    const viewer = await get("a1@company.com");
    expect(outOfScope.res.status).toBe(404);
    expect(missing.res.status).toBe(404);
    expect(viewer.res.status).toBe(404);
    expect(outOfScope.text).toBe(missing.text);
    expect(outOfScope.text).toBe(viewer.text);
  });

  it("an org-wide reader asking for a missing user also gets 404 NOT_FOUND (upstream 404, no leak)", async () => {
    signInAs("admin");
    const { res, text } = await get(GHOST_USER_ID);
    await expectError(res, 404, "NOT_FOUND");
    expect(text).not.toContain("user not found");
  });

  it("returns one user's spend, budget and daily spend via getUser + getUserDailySpend, in UTC (Views: Users; LD20)", async () => {
    signInAs("teamAdminA");
    const { body } = await get("ab@company.com");
    expect(body.data).toMatchObject({
      userId: "ab@company.com",
      email: "ab@company.com",
      spend: 6,
      maxBudget: 10,
    });
    expect(body.data.daily[0]).toMatchObject({
      date: "2026-11-02",
      spend: 1.5,
    });
    const info = state.fake.calls.find((c) => c.path === "/user/info")!;
    expect(new URL(info.url).searchParams.get("user_id")).toBe(
      "ab@company.com",
    );
    const q = new URL(dailyCalls()[0]!.url).searchParams;
    expect(q.get("user_id")).toBe("ab@company.com");
    expect(q.get("timezone")).toBe("0");
    expect(q.get("start_date")).toBe("2026-11-01");
    expect(q.get("end_date")).toBe("2026-11-14");
    expect(body.data.enabledOperations).toContain("getUser");
  });

  it("returns no keys, no key values and no LiteLLM team ids (LT1, LT9; reduction)", async () => {
    signInAs("admin");
    const { body, text } = await get("a1@company.com");
    expectNoSentinels(body);
    expect(body.data).not.toHaveProperty("keys");
    expect(body.data).not.toHaveProperty("teams");
    expect(text).not.toMatch(/sk-/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
  });

  it("a malformed user id is 400 BAD_REQUEST for an allowed caller, no LiteLLM call (path parameter)", async () => {
    signInAs("admin");
    const { res } = await get("../team/delete");
    await expectError(res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("400 BAD_REQUEST for a range over 90 days, no LiteLLM call (Rule 20.8)", async () => {
    signInAs("admin");
    const { res } = await get(
      "a1@company.com",
      "?dateFrom=2026-01-01&dateTo=2026-06-01",
    );
    await expectError(res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each([["getUser"], ["getUserDailySpend"]])(
    "a disabled %s is 403 OPERATION_DISABLED before any LiteLLM call (LD19)",
    async (op) => {
      await setToggles({ [op]: false });
      signInAs("admin");
      const { res } = await get("a1@company.com");
      await expectError(res, 403, "OPERATION_DISABLED");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE without upstream detail (error codes; LT12)", async () => {
    installFake(state, { outage: true });
    signInAs("admin");
    const { res, text } = await get("a1@company.com");
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE (LT11)", async () => {
    useEnv({ AUTH_ACCESS_MODE: "open" });
    signInAs("admin");
    const { res } = await get("a1@company.com");
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
  });
});

// Source: docs/specs/2026-11-10-litellm.md LD23 (per-user LiteLLM cost obeys
// the Organisation cap), LT21; Access Control - "Organisation cap", T16.
// Decision: capped detail is { userId, email, enabledOperations } - `spend`,
// `maxBudget` and `daily` are ABSENT keys, and getUserDailySpend is never
// called. Scope (404 parity) is unchanged by the cap.
describe("GET /api/litellm/users/[litellmUserId] - Organisation cap (LD23, T16)", () => {
  it.each([
    "admin",
    "orgAdmin",
    "auditor",
    "teamAdminA",
    "deptAdminEng",
  ] as const)(
    "%s in prod without the approval gets identity only: no spend, budget or daily, no daily call",
    async (who) => {
      await enterProd();
      signInAs(who);
      const { res, body } = await get("ab@company.com");
      expect(res.status).toBe(200);
      expect(body.data.userId).toBe("ab@company.com");
      expect(body.data.email).toBe("ab@company.com");
      for (const field of ["spend", "maxBudget", "daily"]) {
        expect(body.data, field).not.toHaveProperty(field);
      }
      expect(dailyCalls()).toHaveLength(0);
    },
  );

  it("an out-of-scope user is still the 404 in prod (cap does not widen scope)", async () => {
    await enterProd();
    signInAs("teamAdminA");
    const { res } = await get("c1@company.com");
    await expectError(res, 404, "NOT_FOUND");
  });

  it("with the approval recorded, spend, budget and daily are present again (LD23)", async () => {
    await enterProd({ approved: true });
    signInAs("teamAdminA");
    const { body } = await get("ab@company.com");
    expect(body.data).toMatchObject({ spend: 6, maxBudget: 10 });
    expect(body.data.daily.length).toBeGreaterThan(0);
  });
});

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage (L6)":
// Routes (GET /api/litellm/users/[litellmUserId] "adds `combined`; omitted
// while scope.userLevelCap is below all (LD23)"), The computation (Person P:
// for another person the key set is the canonical email of the LiteLLM user's
// user_email plus that identity's usage identities and aliases), Visibility
// (global readers show/warn; a Lead show/hidden), LT31 ("Per-person combined
// leaks under the Organisation cap": omitted unless userLevelCap = all).
//
// Contract (amended after L6 review round 1, Q1): the 200 data gains an
// optional `combined` = CombinedMeResponseSchema (the same person figure as
// /combined/me, for the viewed person) for GLOBAL READERS ONLY (Admin,
// org-admin, Auditor). It is absent when the cap hides per-user cost, and
// absent for everyone else (a Lead): no key, no Bedrock figure, and the
// gateway config, the usage-key owner and the rollups are never read for them.
// LiteLLMUserDetailResponseSchema accepts it.
describe("GET /api/litellm/users/[litellmUserId] - combined (L6)", () => {
  beforeEach(async () => {
    await seedCombinedExtras();
    installCombined(state, {
      userPages: [[dailyRow(4, { bedrock: 4 })]],
    });
  });
  const detail = (userId = "a1@company.com") => get(userId, `?${RANGE}`);

  it("Admin sees the person's combined figure: direct Bedrock over all their usage keys plus their LiteLLM total", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    signInAs("admin");
    const { res, body } = await detail();
    expect(res.status).toBe(200);
    expect(body.data.userId).toBe("a1@company.com");
    expect(CombinedMeResponseSchema.parse(body.data.combined)).toMatchObject({
      visibility: "show",
      gatewayConfigured: true,
      bedrockDirect: 23,
      litellm: 4,
      litellmUser: true,
      combined: 27,
      costEstimated: true,
    });
  });

  it.each<["orgAdmin" | "auditor"]>([["orgAdmin"], ["auditor"]])(
    "%s: warn when the gateway is not configured",
    async (who) => {
      signInAs(who);
      const { body } = await detail();
      expect(body.data.combined).toMatchObject({
        visibility: "warn",
        gatewayConfigured: false,
        bedrockDirect: 23,
      });
    },
  );

  // L6 review round 1, Q1 (LT32; Access Control - Navigation and landing by
  // role: a Lead has no AWS cost view; Rule 60.10): `combined` is for global
  // readers only. A Lead gets the LiteLLM figures and nothing else, and the
  // route reads no gateway config, no usage-key owner and no rollup for them.
  describe("a Lead in scope gets no combined figure and no out-of-scope read (LT32; route row: global readers only)", () => {
    const BEDROCK_AMOUNTS = /[:[,](23|27|243)[,}\]]/;

    it.each([false, true])(
      "gateway configured = %s: the detail carries LiteLLM figures only, no `combined` key and no Bedrock amount anywhere",
      async (configured) => {
        if (configured) await storeGateway({ accountIds: [GW_ACCOUNT_B] });
        signInAs("teamAdminA");
        const { res, body, text } = await detail();
        expect(res.status).toBe(200);
        expect(body.data).toMatchObject({
          userId: "a1@company.com",
          spend: expect.any(Number),
        });
        expect(body.data).not.toHaveProperty("combined");
        for (const key of FIGURE_KEYS) {
          expect(text).not.toContain(`"${key}"`);
        }
        expect(text).not.toContain("gatewayConfigured");
        expect(text).not.toContain(ALT_KEY);
        expect(text).not.toMatch(BEDROCK_AMOUNTS);
      },
    );

    it("a department Lead likewise gets no `combined`", async () => {
      await storeGateway({ accountIds: [GW_ACCOUNT_B] });
      signInAs("deptAdminEng");
      const { res, body } = await detail("b1@company.com");
      expect(res.status).toBe(200);
      expect(body.data).not.toHaveProperty("combined");
    });

    // Observed at the DynamoDB boundary (Rule 60.21: no spying on internals):
    // absence of a read is only visible there.
    it("reads no gateway config, no usage-key owner and no rollup day for a Lead (checked before any such read)", async () => {
      await storeGateway({ accountIds: [GW_ACCOUNT_B] });
      signInAs("teamAdminA");
      const watch = watchDynamo();
      try {
        const { res } = await detail();
        expect(res.status).toBe(200);
        const reads = watch.reads();
        // LITELLM#CONFIG / CONNECTION and / TOGGLES stay readable for a Lead
        // (LD19 requireEnabled); only the GATEWAY item is out of scope here.
        expect(reads).not.toContain('"SK":"GATEWAY"');
        expect(reads).not.toContain("USAGEKEY#");
        expect(reads).not.toContain("DATE#");
      } finally {
        watch.stop();
      }
    });

    it("control: the same spy sees those reads for Admin, so the Lead absence above is meaningful", async () => {
      await storeGateway({ accountIds: [GW_ACCOUNT_B] });
      signInAs("admin");
      const watch = watchDynamo();
      try {
        await detail();
        const reads = watch.reads();
        expect(reads).toContain('"SK":"GATEWAY"');
        expect(reads).toContain("DATE#");
      } finally {
        watch.stop();
      }
    });
  });

  it("omitted under the Organisation cap (prod, no approval), even for Admin (LD23, LT31)", async () => {
    await enterProd();
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    signInAs("admin");
    const { res, body } = await detail();
    expect(res.status).toBe(200);
    expect(body.data).not.toHaveProperty("combined");
    expect(JSON.stringify(body)).not.toContain("bedrockDirect");
  });

  it("present again once the per-user approval is recorded (userLevelCap = all)", async () => {
    await enterProd({ approved: true });
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    signInAs("admin");
    const { body } = await detail();
    expect(body.data.combined).toMatchObject({
      visibility: "show",
      combined: 27,
    });
  });

  // Rule 60.10 / LT29-LT32: the claimed keys are authorization data.
  it("an out-of-scope caller gets the same 404 as a missing user and no claimed key or figure reaches the body", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    signInAs("teamAdminA");
    const outOfScope = await detail("c1@company.com");
    const missing = await detail(GHOST_USER_ID);
    expect(outOfScope.res.status).toBe(404);
    expect(outOfScope.text).toBe(missing.text);
    expect(outOfScope.text).not.toContain(ALT_KEY);
    expect(outOfScope.text).not.toContain("bedrockDirect");
    const admin = (signInAs("admin"), await detail());
    expect(admin.text).not.toContain(ALT_KEY);
  });

  it("reads the identity link per request: a link change between two requests changes the second figure (Rule 60.10)", async () => {
    await storeGateway({ accountIds: [GW_ACCOUNT_B] });
    signInAs("admin");
    expect((await detail()).body.data.combined.bedrockDirect).toBe(23);
    const current = await getIdentityLink(CALLERS.memberA.oid);
    ok(
      await putIdentityLink(
        {
          oid: CALLERS.memberA.oid,
          usageIdentities: [CALLERS.memberA.email],
          aliases: [],
          litellmUserId: LUSER.memberA,
          version: current?.version ?? null,
        },
        ctxAt(undefined, "req-ident-drop"),
      ),
    );
    expect((await detail()).body.data.combined.bedrockDirect).toBe(21);
  });
});

// Source: Design System - Management pages, LiteLLM users tab, D-LF1 (a field
// LiteLLM may omit is optional or nullable in the schema, one exported schema
// per route response) and T-LF1 (a LiteLLM user with no usage fields renders
// the usage section with "—"). The bodies are what UserInfoResponse in
// docs/litellm/openapi.json allows: user_id, user_info, keys and teams are
// required, user_info is an open object or null, so spend, max_budget and
// user_email can all be missing.
describe("GET /api/litellm/users/[litellmUserId] - a user whose /user/info omits usage fields (D-LF1, T-LF1)", () => {
  const ID = "lone@company.com";
  const BODIES: Array<[string, unknown]> = [
    [
      "user_info with only the id and role",
      {
        user_id: ID,
        user_info: { user_id: ID, user_role: "internal_user" },
        keys: [],
        teams: [],
      },
    ],
    ["user_info empty", { user_id: ID, user_info: {}, keys: [], teams: [] }],
    ["user_info null", { user_id: ID, user_info: null, keys: [], teams: [] }],
    [
      "user_id null and user_info null",
      { user_id: null, user_info: null, keys: [], teams: [] },
    ],
  ];

  it.each(BODIES)(
    "%s: 200, parses with the exported detail schema, no invented zero spend",
    async (_name, upstream) => {
      installFake(state, { userInfoBodies: { [ID]: upstream } });
      signInAs("admin");
      const { res, body } = await get(ID);
      expect(res.status).toBe(200);
      const { LiteLLMUserDetailResponseSchema } =
        await import("@llm-usage-lens/shared");
      const parsed = LiteLLMUserDetailResponseSchema.parse(body.data);
      expect(parsed.userId).toBe(ID);
      expect(parsed.email).toBe(ID);
      expect(parsed.spend).toBeNull();
    },
  );

  // openapi.json types `keys` and `teams` as arrays of unconstrained items, so
  // a key row without `token` or a team row without `team_id` is a valid reply
  // and the detail, which uses neither, must still answer. Today the gateway
  // schema requires `token` (lib/litellm/operations.ts, KeyRow), so such a
  // reply fails with "expected string, received undefined" at keys[0].token.
  it("keys and teams rows with no token or team id do not fail the read; spend and budget come through", async () => {
    installFake(state, {
      userInfoBodies: {
        [ID]: {
          user_id: ID,
          user_info: { user_id: ID, spend: 4.5, max_budget: 9 },
          keys: [{ key_alias: "no-token-field" }],
          teams: [{ team_alias: "no-team-id-field" }],
        },
      },
    });
    signInAs("admin");
    const { res, body } = await get(ID);
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ spend: 4.5, maxBudget: 9 });
  });

  // Source: LiteLLM spec - contract drift is a Zod-parse failure on an
  // allowlisted field (503 LITELLM_UNAVAILABLE, never loosened); Design System
  // users tab LF1 decision (a) drops only a row with no token (Q-B1).
  it("a key row WITH a token but a malformed allowlisted field is contract drift, 503 LITELLM_UNAVAILABLE (Q-B1)", async () => {
    installFake(state, {
      userInfoBodies: {
        [ID]: {
          user_id: ID,
          user_info: { user_id: ID, spend: 4.5, max_budget: 9 },
          keys: [{ token: "a".repeat(64), blocked: "yes" }],
          teams: [],
        },
      },
    });
    signInAs("admin");
    const { res } = await get(ID);
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
  });

  it("a token-less malformed row is dropped while a valid keyed row stays: the read succeeds (decision (a), Q-B1)", async () => {
    installFake(state, {
      userInfoBodies: {
        [ID]: {
          user_id: ID,
          user_info: { user_id: ID, spend: 4.5, max_budget: 9 },
          keys: [{ blocked: "yes" }, { key_alias: "no-token" }],
          teams: [],
        },
      },
    });
    signInAs("admin");
    const { res, body } = await get(ID);
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ spend: 4.5 });
  });

  it("the same user under the Organisation cap still answers identity only (LD23)", async () => {
    await enterProd();
    installFake(state, {
      userInfoBodies: {
        [ID]: { user_id: ID, user_info: null, keys: [], teams: [] },
      },
    });
    signInAs("admin");
    const { res, body } = await get(ID);
    expect(res.status).toBe(200);
    expect(body.data).not.toHaveProperty("spend");
  });
});
