import { describe, expect, it, vi } from "vitest";

import { grantAdminScope } from "@/lib/data/access/admin-scopes";
import { createAppTeam } from "@/lib/data/access/app-teams";
import { putTeamLink } from "@/lib/data/litellm/team-links";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import type { FakeHandler } from "@/test/fakes/fake-litellm";
import {
  GHOST_USER_ID,
  LTEAM,
  call,
  enterProd,
  expectError,
  expectNoSentinels,
  seedViews,
  setToggles,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
  urlsCalled,
  useEnv,
  viewsHandler,
} from "@/test/fakes/fake-litellm-views";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import { clearTable } from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-litellm.md - `resetMemberSpend` row (RS1: the
// Reset spend dialog), "Reads" (getUser, getTeam), "Roles and rights" (Lead in
// scope, org-admin, Admin write members; Auditor, Viewer, member never),
// LD19 (a disabled read is 403 before any call), LD20/LD23 (Organisation cap
// hides per-user cost), LD37 (not configured is 200 configured:false, no
// LiteLLM call), LT21 (out of scope is the same 404 as missing), Access
// Control - Enforcement item 2; Design System - "Reset spend from the
// LiteLLM users tab and the Users page" (D1-D5), Rules 10.3, 60.23, 60.24a;
// App Teams spec - "Teams without an AWS account" (a created team takes a
// link, so it is a resettable team like a registry team).
//
// Contract for the developer
// (.../users/[litellmUserId]/memberships/route.ts, GET, the ONE new read of
// unit RS1; no new write route and no new allowlisted operation):
//   path: litellmUserId (a LiteLLM user id; malformed -> 400 after the role
//   check, no LiteLLM call). No query. The person's `oid` is NOT needed or
//   returned: the dialog already holds it from the row, and the reset route
//   resolves the LiteLLM user from it.
//   200 data = { configured?: false, items: [{ teamId, teamName, spend?,
//   maxBudget? }] } - `teamId` is the DASHBOARD team id (the reset route's
//   path segment), never a LiteLLM team id; `maxBudget: null` = unlimited;
//   `spend`/`maxBudget` are the person's spend and budget IN THAT TEAM (the
//   team_memberships row), omitted under the Organisation cap (LD23).
//   Items = the person's LiteLLM teams (getUser) that are linked to a
//   dashboard team AND that the caller may reset: Lead -> own teams in scope,
//   org-admin/Admin -> every linked team (the matrix `member` write), then
//   getTeam once per such team, sorted by team name. A person with no
//   resettable team is 200 `items: []` for org-admin/Admin.
//   Caller who may reset nowhere (Auditor, Viewer, member, no role) and a Lead
//   whose scope holds none of the person's teams: the SAME 404 NOT_FOUND as a
//   missing user (LT21), and no getTeam call (decision, Enforcement 2 hidden
//   means absent; an Auditor reads people elsewhere but cannot reset).
//   Toggles (LD19): getUser and getTeam off -> 403 OPERATION_DISABLED before
//   any call. `resetMemberSpend` off does NOT refuse this read (it is the
//   write route's gate, LD10; the UI hides the action from the list's
//   enabledOperations) - agent decision, a read never exposes more than the
//   Team page members read already shows the same caller.
//   LD37: no stored connection -> 200 { configured: false, items: [] }, no
//   LiteLLM call, after the role check and the toggle check.
//   Outage 503 LITELLM_UNAVAILABLE; open access mode 403 OPERATION_UNAVAILABLE;
//   Cache-Control private, no-store. Registered in test/route-registry.ts
//   (the 401/no-store shape cases are the shared suite's).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupViewsSuite();
const get = async (userId: string) => {
  stubLiteLLMEnv();
  const { GET } = await import("./route");
  return call(
    GET,
    `/api/litellm/users/${encodeURIComponent(userId)}/memberships`,
    { litellmUserId: userId },
  );
};

// Per-team membership rows (spend, budget) for the people under test; the
// shared views fake answers the same single row for every team.
const SPEND: Record<
  string,
  Record<string, { spend: number; max: number | null }>
> = {
  "a1@company.com": { "team-a": { spend: 3.25, max: 10 } },
  "ab@company.com": {
    "team-a": { spend: 6, max: 10 },
    "team-b": { spend: 2, max: null },
    created: { spend: 4.5, max: 8 },
  },
  "mix@company.com": {
    "team-a": { spend: 7, max: null },
    "team-c": { spend: 1.5, max: 20 },
  },
};
// A LiteLLM team only a created app team (M2) links to; ab@ belongs to it on
// the proxy side, but it is listed only once a link exists.
const CREATED_LTEAM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TEAM_OF: Record<string, string> = {
  ...Object.fromEntries(Object.entries(LTEAM).map(([team, id]) => [id, team])),
  [CREATED_LTEAM]: "created",
};

function installMemberships(opts: { outage?: boolean } = {}) {
  const base = viewsHandler(opts);
  const handler: FakeHandler = (c, attempt) => {
    const reply = base(c, attempt);
    if (
      c.method === "GET" &&
      c.path === "/user/info" &&
      new URL(c.url).searchParams.get("user_id") === "ab@company.com" &&
      typeof reply !== "string"
    ) {
      const body = reply.body as { teams: unknown[] };
      return {
        status: reply.status,
        body: { ...body, teams: [...body.teams, { team_id: CREATED_LTEAM }] },
      };
    }
    if (c.method !== "GET" || c.path !== "/team/info") return reply;
    const lteam = new URL(c.url).searchParams.get("team_id") ?? "";
    const team = TEAM_OF[lteam];
    if (!team || typeof reply === "string") return reply;
    const rows = Object.entries(SPEND).flatMap(([user, teams]) => {
      const row = teams[team];
      return row
        ? [
            {
              user_id: user,
              team_id: lteam,
              spend: row.spend,
              internal_note: "MEMBERSHIP-SENTINEL",
              litellm_budget_table:
                row.max === null ? null : { max_budget: row.max },
            },
          ]
        : [];
    });
    const body = reply.body as { team_info: Record<string, unknown> };
    return {
      status: reply.status,
      body: {
        ...body,
        team_info: {
          ...body.team_info,
          members_with_roles: rows.map((r) => ({
            user_id: r.user_id,
            user_email: r.user_id,
            role: "user",
          })),
        },
        team_memberships: rows,
      },
    };
  };
  state.fake = createFakeLiteLLM(handler);
  vi.stubGlobal("fetch", state.fake.fetch);
}

type Who = CallerName | "noRole";
const as = async (who: Who) => {
  if (who === "noRole") await signInWithRoles([]);
  else signInAs(who);
};
const teamIds = (body: { data: { items: Array<{ teamId: string }> } }) =>
  body.data.items.map((i) => i.teamId).sort();
const teamCalls = () => state.fake.calls.filter((c) => c.path === "/team/info");

describe("GET /api/litellm/users/[litellmUserId]/memberships (RS1)", () => {
  // [caller, person, team ids listed | 404] - complete role x person matrix
  // (security, Rule 60.24a): only teams the caller may reset are listed.
  const MATRIX: Array<[Who, string, string[] | 404]> = [
    ["memberA", "a1@company.com", 404],
    ["viewerNone", "a1@company.com", 404],
    ["noRole", "a1@company.com", 404],
    ["auditor", "ab@company.com", 404],
    ["teamAdminA", "a1@company.com", ["team-a"]],
    ["teamAdminA", "ab@company.com", ["team-a"]],
    ["teamAdminA", "mix@company.com", ["team-a"]],
    ["teamAdminA", "b1@company.com", 404],
    ["teamAdminA", "c1@company.com", 404],
    ["teamAdminA", "lone@company.com", 404],
    ["deptAdminEng", "ab@company.com", ["team-a", "team-b"]],
    ["deptAdminEng", "mix@company.com", ["team-a"]],
    ["deptAdminEng", "c1@company.com", 404],
    ["orgAdmin", "ab@company.com", ["team-a", "team-b"]],
    ["orgAdmin", "mix@company.com", ["team-a", "team-c"]],
    ["orgAdmin", "lone@company.com", []],
    ["admin", "mix@company.com", ["team-a", "team-c"]],
    ["admin", "lone@company.com", []],
  ];
  it.each(MATRIX)(
    "%s asking for %s: %j (Roles and rights; LT21)",
    async (who, user, expected) => {
      installMemberships();
      await as(who);
      const { res, body } = await get(user);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      if (expected === 404) {
        await expectError(res, 404, "NOT_FOUND");
        expect(teamCalls()).toHaveLength(0);
      } else {
        expect(res.status).toBe(200);
        expect(teamIds(body as never)).toEqual(expected);
      }
    },
  );

  // Source: review Q-B1; App Teams - "Teams without an AWS account"; Access
  // Control - "Created app teams"; the team directory is registry + created.
  async function linkCreatedTeam() {
    const teamId = ok(
      await createAppTeam(
        {
          name: "Guild",
          departmentId: "dept-eng",
          departmentName: "Engineering",
        },
        ctxAt(undefined, "req-created-team"),
      ),
    ).teamId;
    ok(
      await putTeamLink(
        { teamId, litellmTeamId: CREATED_LTEAM, version: null },
        ctxAt(undefined, "req-link-created"),
      ),
    );
    return teamId;
  }

  it("a created app team linked to one of the person's LiteLLM teams is listed for an admin, with its figures (Q-B1)", async () => {
    installMemberships();
    const created = await linkCreatedTeam();
    signInAs("admin");
    const { res, body } = await get("ab@company.com");
    expect(res.status).toBe(200);
    expect(body.data.items).toEqual([
      { teamId: "team-a", teamName: "A", spend: 6, maxBudget: 10 },
      { teamId: "team-b", teamName: "B", spend: 2, maxBudget: null },
      { teamId: created, teamName: "Guild", spend: 4.5, maxBudget: 8 },
    ]);
  });

  it("a Lead in scope of only the created team sees it instead of the 404, and reads only that team (Q-B1; Enforcement 2)", async () => {
    installMemberships();
    const created = await linkCreatedTeam();
    ok(
      await grantAdminScope(
        {
          oid: CALLERS.viewerNone.oid,
          scopeType: "team",
          scopeId: created,
        },
        ctxAt(undefined, "req-lead-created"),
      ),
    );
    signInAs("viewerNone");
    const { res, body } = await get("ab@company.com");
    expect(res.status).toBe(200);
    expect(teamIds(body as never)).toEqual([created]);
    expect(teamCalls()).toHaveLength(1);
    expect(urlsCalled(state)).toContain(CREATED_LTEAM);
  });

  it("a created team nobody links stays unlisted, and a Lead scoped to it alone still gets the 404 (Q-B1)", async () => {
    installMemberships();
    const teamId = ok(
      await createAppTeam(
        {
          name: "Guild",
          departmentId: "dept-eng",
          departmentName: "Engineering",
        },
        ctxAt(undefined, "req-created-unlinked"),
      ),
    ).teamId;
    ok(
      await grantAdminScope(
        { oid: CALLERS.viewerNone.oid, scopeType: "team", scopeId: teamId },
        ctxAt(undefined, "req-lead-unlinked"),
      ),
    );
    signInAs("viewerNone");
    await expectError((await get("ab@company.com")).res, 404, "NOT_FOUND");
  });

  it("a caller who may not reset anywhere makes no LiteLLM call at all (Enforcement 2)", async () => {
    installMemberships();
    await as("auditor");
    await get("ab@company.com");
    await as("memberA");
    await get("a1@company.com");
    await as("noRole");
    await get("a1@company.com");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("out of scope for a Lead, a missing user and a caller with no right all give the same 404 body (LT21)", async () => {
    installMemberships();
    signInAs("teamAdminA");
    const outOfScope = await get("c1@company.com");
    const missing = await get(GHOST_USER_ID);
    await as("auditor");
    const auditor = await get("ab@company.com");
    expect(outOfScope.res.status).toBe(404);
    expect(missing.res.status).toBe(404);
    expect(auditor.res.status).toBe(404);
    expect(outOfScope.text).toBe(missing.text);
    expect(outOfScope.text).toBe(auditor.text);
  });

  it("an org-wide writer asking for a missing user gets the 404, with no upstream detail (LT12)", async () => {
    installMemberships();
    signInAs("admin");
    const { res, text } = await get(GHOST_USER_ID);
    await expectError(res, 404, "NOT_FOUND");
    expect(text).not.toContain("user not found");
  });

  it("lists each resettable team with the person's spend and budget in that team, null budget = unlimited (D2, D5)", async () => {
    installMemberships();
    signInAs("orgAdmin");
    const { body } = await get("ab@company.com");
    expect(body.data.items).toEqual([
      { teamId: "team-a", teamName: "A", spend: 6, maxBudget: 10 },
      { teamId: "team-b", teamName: "B", spend: 2, maxBudget: null },
    ]);
  });

  it("a Lead's call reads only the teams in scope, never the others (D3: a Lead sees only its own)", async () => {
    installMemberships();
    signInAs("teamAdminA");
    await get("ab@company.com");
    expect(teamCalls()).toHaveLength(1);
    expect(urlsCalled(state)).toContain(LTEAM["team-a"]);
    expect(urlsCalled(state)).not.toContain(LTEAM["team-b"]);
  });

  it("only reads: no write call is ever sent, and no LiteLLM team id, key or loose field leaves the server (LT1, LT9)", async () => {
    installMemberships();
    signInAs("admin");
    const { body, text } = await get("mix@company.com");
    expect(state.fake.calls.every((c) => c.method === "GET")).toBe(true);
    expectNoSentinels(body);
    expect(text).not.toMatch(/sk-/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
    expect(JSON.stringify(body.data.items)).not.toContain("oid");
  });

  it("a malformed user id is 400 BAD_REQUEST for an allowed caller, no LiteLLM call (path parameter)", async () => {
    installMemberships();
    signInAs("admin");
    const { res } = await get("../team/delete");
    await expectError(res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each([["getUser"], ["getTeam"]])(
    "a disabled %s is 403 OPERATION_DISABLED before any LiteLLM call (LD19)",
    async (op) => {
      installMemberships();
      await setToggles({ [op]: false });
      signInAs("admin");
      const { res } = await get("ab@company.com");
      await expectError(res, 403, "OPERATION_DISABLED");
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("resetMemberSpend off does not refuse the read; the write route holds that gate (LD10, agent decision)", async () => {
    installMemberships();
    await setToggles({ resetMemberSpend: false });
    signInAs("admin");
    const { res, body } = await get("ab@company.com");
    expect(res.status).toBe(200);
    expect(teamIds(body as never)).toEqual(["team-a", "team-b"]);
  });

  it("no stored connection is 200 configured:false with no items and no LiteLLM call (LD37); a caller with no right is still the 404", async () => {
    installMemberships();
    await clearTable();
    await seedViews({ connection: false });
    signInAs("admin");
    const { res, body } = await get("ab@company.com");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data).toEqual({ configured: false, items: [] });
    expect(state.fake.calls).toHaveLength(0);
    await as("auditor");
    await expectError((await get("ab@company.com")).res, 404, "NOT_FOUND");
  });

  it("a configured response does not carry configured:false (LD37)", async () => {
    installMemberships();
    signInAs("admin");
    const { body } = await get("ab@company.com");
    expect(body.data.configured).not.toBe(false);
  });

  it("the Organisation cap lists the teams but omits spend and budget (LD23; T16)", async () => {
    installMemberships();
    await enterProd();
    signInAs("admin");
    const { res, body } = await get("ab@company.com");
    expect(res.status).toBe(200);
    expect(body.data.items).toEqual([
      { teamId: "team-a", teamName: "A" },
      { teamId: "team-b", teamName: "B" },
    ]);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE without upstream detail (error codes; LT12)", async () => {
    installMemberships({ outage: true });
    signInAs("admin");
    const { res, text } = await get("ab@company.com");
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE (LT11)", async () => {
    installMemberships();
    useEnv({ AUTH_ACCESS_MODE: "open" });
    signInAs("admin");
    const { res } = await get("ab@company.com");
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
  });

  it("uses the caller's own oid-free path: memberA's own person row is a 404 for a viewer (Roles and rights)", async () => {
    installMemberships();
    signInAs("memberA");
    const { res } = await get(CALLERS.memberA.email);
    await expectError(res, 404, "NOT_FOUND");
  });
});
