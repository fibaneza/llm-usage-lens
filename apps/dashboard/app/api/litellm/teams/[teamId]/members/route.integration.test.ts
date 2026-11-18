import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LTEAM,
  UNLINKED_LTEAM,
  enterProd,
  call,
  defineTeamReadContract,
  expectNoSentinels,
  stubLiteLLMEnv,
  useEnv,
} from "@/test/fakes/fake-litellm-views";
import {
  BOB_LUSER,
  PEOPLE,
  bodyOf,
  callsTo,
  defineMemberWriteContract,
  expectError,
  installMemberWritesFake,
  memberAudit,
  send,
  setToggles,
  setupMemberWritesSuite,
  writeCalls,
} from "@/test/support/litellm-member-writes-support";
import { createAppTeam } from "@/lib/data/access/app-teams";
import { putTeamLink } from "@/lib/data/litellm/team-links";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { seedMember } from "@/test/support/matrix-route-support";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId]/members GET in scope), "Roles and rights" (Lead sees members' spend,
// budgets and limits), "Reads" (getTeam; team_memberships are loose rows),
// "Identity mapping and members", implementation-phases L3 Verify, Rule 60.23.
//
// Contract for the developer (.../members/route.ts, GET):
//   200 data = { connected: false, items: [] } when unlinked, else
//   { connected: true,
//     items: [{ email, spend, maxBudget, rpmLimit, tpmLimit, ... }] }  (allowlisted fields only)
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupMemberWritesSuite();
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).GET;
};

defineTeamReadContract(state, {
  full: false,
  load,
  suffix: "/members",
  query: "",
  toggleOp: "getTeam",
  upstreamPath: "/team/info",
});

describe("GET /api/litellm/teams/[teamId]/members", () => {
  it("lists members with their LiteLLM-reported spend, budget and limits (Roles and rights: Lead)", async () => {
    signInAs("teamAdminA");
    const { body } = await call(
      await load(),
      "/api/litellm/teams/team-a/members",
      {
        teamId: "team-a",
      },
    );
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      email: "a1@company.com",
      spend: 3.25,
      maxBudget: 10,
      rpmLimit: 5,
      tpmLimit: 500,
    });
    expect(JSON.stringify(state.fake.calls.map((c) => c.url))).toContain(
      LTEAM["team-a"],
    );
  });

  it("membership rows are reduced to allowlisted fields (cost visualisation; LT1)", async () => {
    signInAs("admin");
    const { body } = await call(
      await load(),
      "/api/litellm/teams/team-a/members",
      {
        teamId: "team-a",
      },
    );
    expectNoSentinels(body);
    for (const banned of ["budget_id", "created_by", "litellm_budget_table"]) {
      expect(JSON.stringify(body)).not.toContain(banned);
    }
  });
});

// Source: docs/specs/2026-11-10-litellm.md -- "Team configuration page (L4)"
// (members: add), "Writes" (addTeamMember: Lead for existing dashboard members
// of the team, Admin), LD23 (identities carry no cost); coordinator decision
// 2026-11-16. Contract: GET .../members also returns
//   candidates: [{ oid, name, email }]
// = dashboard members of [teamId] (with an identity email) who are not
// members of the linked LiteLLM team (matched by email). Present only for
// callers who can write members (Lead in scope, org-admin, Admin); the key is
// absent for the Auditor. Identities only: never spend or budget, so the
// Organisation cap leaves it untouched.
describe("GET /api/litellm/teams/[teamId]/members - candidates (add-member picker)", () => {
  const get = async () =>
    call(await load(), "/api/litellm/teams/team-a/members", {
      teamId: "team-a",
    });
  const sorted = (rows: Array<{ oid: string }>) =>
    rows.map((r) => r.oid).sort();

  it.each(["admin", "orgAdmin", "teamAdminA", "deptAdminEng"] as const)(
    "%s gets the dashboard members not yet in the LiteLLM team, identities only",
    async (who) => {
      signInAs(who);
      const { body } = await get();
      expect(sorted(body.data.candidates)).toEqual(
        [PEOPLE.alice.oid, PEOPLE.bob.oid].sort(),
      );
      const alice = body.data.candidates.find(
        (c: { oid: string }) => c.oid === PEOPLE.alice.oid,
      );
      expect(alice).toEqual({
        oid: PEOPLE.alice.oid,
        name: PEOPLE.alice.name,
        email: PEOPLE.alice.email,
      });
    },
  );

  it("excludes a dashboard member who is already in the LiteLLM team (memberA, a1@company.com)", async () => {
    signInAs("admin");
    const { body } = await get();
    const emails = body.data.candidates.map((c: { email: string }) => c.email);
    expect(emails).not.toContain("a1@company.com");
  });

  it("the Auditor gets no candidates key (cannot write members)", async () => {
    signInAs("auditor");
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(body.data).not.toHaveProperty("candidates");
  });

  it("a Lead still gets candidates under the Organisation cap, with no cost fields (LD23)", async () => {
    await enterProd();
    signInAs("teamAdminA");
    const { body } = await get();
    expect(body.data.candidates).toHaveLength(2);
    for (const c of body.data.candidates) {
      expect(Object.keys(c).sort()).toEqual(["email", "name", "oid"]);
    }
  });
});

// Source: docs/specs/2026-11-17-app-teams.md - "Teams without an AWS account"
// (a created team takes members and a link); Access Control MI-D7 (a department
// scope covers a created team by its stored departmentId), T-MI4. The add
// candidates are offered only when the team is known and the caller may write
// its members; that lookup reads the team directory (M2 design 1, group M2-b).
describe("GET /api/litellm/teams/[teamId]/members - candidates of a linked created team (App Teams; MI-D7)", () => {
  let created: string;
  const get = async () =>
    call(await load(), `/api/litellm/teams/${created}/members`, {
      teamId: created,
    });
  beforeEach(async () => {
    created = ok(
      await createAppTeam(
        {
          name: "Guild",
          departmentId: "dept-eng",
          departmentName: "Engineering",
        },
        ctxAt(undefined, "req-members-created"),
      ),
    ).teamId;
    ok(
      await putTeamLink(
        { teamId: created, litellmTeamId: UNLINKED_LTEAM, version: null },
        ctxAt(undefined, "req-members-created-link"),
      ),
    );
    await seedMember(PEOPLE.carol.oid, created);
  });

  it.each(["admin", "orgAdmin", "deptAdminEng"] as const)(
    "%s gets the created team's dashboard member as an add candidate, identities only",
    async (who) => {
      signInAs(who);
      const { res, body } = await get();
      expect(res.status).toBe(200);
      expect(body.data.candidates).toEqual([
        {
          oid: PEOPLE.carol.oid,
          name: PEOPLE.carol.name,
          email: PEOPLE.carol.email,
        },
      ]);
    },
  );

  it("the Auditor reads the team but gets no candidates key; a Lead of another team gets 404 (T-MI4)", async () => {
    signInAs("auditor");
    const audit = await get();
    expect(audit.res.status).toBe(200);
    expect(audit.body.data).not.toHaveProperty("candidates");
    signInAs("teamAdminA");
    expect((await get()).res.status).toBe(404);
  });
});

// Source: docs/specs/2026-11-10-litellm.md LD23 (per-user LiteLLM cost obeys
// the Organisation cap), "Roles and rights"; Access Control - "Organisation
// cap", T16. Decision: capped member items keep identity and limits (email,
// userId, rpmLimit, tpmLimit, oid, name) and OMIT `spend`, `maxBudget` and
// `budgetDuration` (absent keys). The team-level totals are not per-user and
// are untouched.
describe("GET /api/litellm/teams/[teamId]/members - Organisation cap (LD23, T16)", () => {
  it.each([
    "admin",
    "orgAdmin",
    "auditor",
    "teamAdminA",
    "deptAdminEng",
  ] as const)(
    "%s in prod without the approval gets member identities but no per-user spend or budget",
    async (who) => {
      await enterProd();
      signInAs(who);
      const { res, body } = await call(
        await load(),
        "/api/litellm/teams/team-a/members",
        { teamId: "team-a" },
      );
      expect(res.status).toBe(200);
      expect(body.data.items).toHaveLength(1);
      const item = body.data.items[0];
      expect(item.email).toBe("a1@company.com");
      for (const field of ["spend", "maxBudget", "budgetDuration"]) {
        expect(item, field).not.toHaveProperty(field);
      }
    },
  );

  it("with the approval recorded, spend and budget are present again (LD23)", async () => {
    await enterProd({ approved: true });
    signInAs("teamAdminA");
    const { body } = await call(
      await load(),
      "/api/litellm/teams/team-a/members",
      { teamId: "team-a" },
    );
    expect(body.data.items[0]).toMatchObject({ spend: 3.25, maxBudget: 10 });
  });
});

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (addTeamMember: Lead only
// for existing dashboard members of the team, Admin; user body user_id =
// user_email = lower-cased email, user_role internal_user, auto_create_key
// false, send_invite_email false; member body team_id, member {user_id, role
// "user"}, max_budget_in_team, budget_duration; audit litellmUserId, budget),
// "Allowlist" (privileged targets: 409 PRIVILEGED_TARGET with no write, also
// recorded as denied), "Identity mapping and members" (OSS creates a missing
// user; Enterprise never creates one: 409 CONFLICT; the id stored is the one
// LiteLLM returns), "Budgets and limits" (member budget <= team max_budget),
// LD10, LD12, LT13, LT16, LT18.
//
// Contract: POST /api/litellm/teams/[teamId]/members, strict body
//   { oid: string, maxBudgetInTeam?: number > 0, budgetDuration?: string }.
//   201 { data: { oid, litellmUserId } }. Order: scope/permission (403/404),
//   body (400), link (409 CONFLICT when the team is unlinked), toggle (403),
//   then the oid must be a dashboard member of [teamId] (else 404 NOT_FOUND,
//   no write) with an identity email; reads: GET /user/list?user_email=, then
//   GET /user/info for the role check; writes: POST /user/new (OSS, missing
//   only) then POST /team/member_add. Audit litellm.member.add, target
//   { type: "litellm-user", id: litellmUserId }, after { litellmUserId,
//   maxBudgetInTeam? }.
const loadPost = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).POST;
};
const PATTERN = "/api/litellm/teams/[teamId]/members";
const membersUrl = (team: string) => `/api/litellm/teams/${team}/members`;

defineMemberWriteContract(state, {
  method: "POST",
  pattern: PATTERN,
  action: "litellm.member.add",
  toggleOp: "addTeamMember",
  okStatus: 201,
  load: loadPost,
  path: (team) => membersUrl(team),
  body: { oid: PEOPLE.alice.oid },
  target: PEOPLE.alice.oid,
  isAdd: true,
});

describe("POST /api/litellm/teams/[teamId]/members", () => {
  const add = async (payload: unknown, team = "team-a") =>
    send(await loadPost(), {
      method: "POST",
      path: membersUrl(team),
      params: { teamId: team },
      body: payload,
    });

  it("OSS: creates a missing LiteLLM user with the exact body, then adds the member, and audits it (Writes; Identity mapping)", async () => {
    signInAs("teamAdminA");
    const { res, body } = await add({
      oid: PEOPLE.alice.oid,
      maxBudgetInTeam: 20,
      budgetDuration: "30d",
    });
    expect(res.status).toBe(201);
    expect(body.data).toEqual({
      oid: PEOPLE.alice.oid,
      litellmUserId: PEOPLE.alice.email,
    });
    expect(writeCalls(state).map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /user/new",
      "POST /team/member_add",
    ]);
    expect(bodyOf(callsTo(state, "POST /user/new")[0])).toEqual({
      user_id: PEOPLE.alice.email,
      user_email: PEOPLE.alice.email,
      user_role: "internal_user",
      auto_create_key: false,
      send_invite_email: false,
    });
    expect(bodyOf(callsTo(state, "POST /team/member_add")[0])).toEqual({
      team_id: LTEAM["team-a"],
      member: { user_id: PEOPLE.alice.email, role: "user" },
      max_budget_in_team: 20,
      budget_duration: "30d",
    });
    expect(JSON.stringify(body)).not.toContain("sk-AUTOCREATED-TRAP");
    const [record, ...rest] = await memberAudit();
    expect(rest).toHaveLength(0);
    expect(record).toMatchObject({
      action: "litellm.member.add",
      result: "success",
      actor: CALLERS.teamAdminA.oid,
      teamId: "team-a",
      target: { type: "litellm-user", id: PEOPLE.alice.email },
      after: { litellmUserId: PEOPLE.alice.email, maxBudgetInTeam: 20 },
    });
    expect(JSON.stringify(record)).not.toContain("sk-AUTOCREATED-TRAP");
  });

  it("an existing LiteLLM user is added without /user/new, using the id LiteLLM returned (Identity mapping)", async () => {
    signInAs("admin");
    const { res, body } = await add({ oid: PEOPLE.bob.oid });
    expect(res.status).toBe(201);
    expect(body.data.litellmUserId).toBe(BOB_LUSER);
    expect(callsTo(state, "POST /user/new")).toHaveLength(0);
    expect(bodyOf(callsTo(state, "POST /team/member_add")[0])).toEqual({
      team_id: LTEAM["team-a"],
      member: { user_id: BOB_LUSER, role: "user" },
    });
  });

  it("Enterprise: a person not yet signed in to LiteLLM is 409 CONFLICT and /user/new is never called (LT16)", async () => {
    await enterProd();
    signInAs("admin");
    const { res } = await add({ oid: PEOPLE.alice.oid });
    await expectError(res, 409, "CONFLICT");
    expect(writeCalls(state)).toHaveLength(0);
  });

  it("Enterprise: an existing LiteLLM user is added with the user_id LiteLLM returned (Identity mapping)", async () => {
    await enterProd();
    signInAs("admin");
    const { res } = await add({ oid: PEOPLE.bob.oid });
    expect(res.status).toBe(201);
    expect(callsTo(state, "POST /user/new")).toHaveLength(0);
    expect(callsTo(state, "POST /team/member_add")).toHaveLength(1);
  });

  it.each(["proxy_admin", "proxy_admin_viewer"])(
    "a %s target is 409 PRIVILEGED_TARGET with no LiteLLM write, recorded as a denied attempt (LT18, LD12)",
    async (role) => {
      installMemberWritesFake(state, { roles: { [BOB_LUSER]: role } });
      signInAs("teamAdminA");
      const { res } = await add({ oid: PEOPLE.bob.oid });
      await expectError(res, 409, "PRIVILEGED_TARGET");
      expect(writeCalls(state)).toHaveLength(0);
      const records = await memberAudit();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "litellm.member.add",
        result: "denied",
        code: "PRIVILEGED_TARGET",
        actor: CALLERS.teamAdminA.oid,
      });
    },
  );

  it("an internal_user_viewer target is not privileged (Allowlist: internal_user or internal_user_viewer)", async () => {
    installMemberWritesFake(state, {
      roles: { [BOB_LUSER]: "internal_user_viewer" },
    });
    signInAs("admin");
    expect((await add({ oid: PEOPLE.bob.oid })).res.status).toBe(201);
  });

  it.each([
    ["a person who is not a dashboard member of the team", PEOPLE.carol.oid],
    ["another team's member", CALLERS.memberB.oid],
    ["an unknown oid", "00000000-0000-4000-8000-00000000dead"],
  ])(
    "%s is 404 NOT_FOUND with no LiteLLM write (Members: only existing dashboard members; LT5)",
    async (_n, oid) => {
      signInAs("teamAdminA");
      await expectError((await add({ oid })).res, 404, "NOT_FOUND");
      expect(writeCalls(state)).toHaveLength(0);
    },
  );

  it.each([
    ["more than the team's max_budget of 100", { maxBudgetInTeam: 100.01 }],
    ["a negative budget", { maxBudgetInTeam: -1 }],
    [
      "a zero budget (LiteLLM reads 0 as blocked; B3 PositiveBudget)",
      { maxBudgetInTeam: 0 },
    ],
    ["a malformed duration", { budgetDuration: "forever" }],
    ["an unknown field (strict body)", { role: "admin" }],
    ["a client-supplied email", { email: "x@company.com" }],
  ])(
    "a body with %s is 400 BAD_REQUEST with no LiteLLM write (LT13; strict inputs)",
    async (_n, extra) => {
      signInAs("admin");
      const { res } = await add({ oid: PEOPLE.alice.oid, ...extra });
      await expectError(res, 400, "BAD_REQUEST");
      expect(writeCalls(state)).toHaveLength(0);
    },
  );

  it("the budget ceiling is inclusive: exactly the team's max_budget is allowed (LT13)", async () => {
    signInAs("admin");
    const { res } = await add({
      oid: PEOPLE.alice.oid,
      maxBudgetInTeam: 100,
    });
    expect(res.status).toBe(201);
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE with no LiteLLM call (LT11)", async () => {
    signInAs("admin");
    useEnv({ AUTH_ACCESS_MODE: "open" });
    await expectError(
      (await add({ oid: PEOPLE.alice.oid })).res,
      403,
      "OPERATION_UNAVAILABLE",
    );
    expect(state.fake.calls).toHaveLength(0);
  });

  it("addTeamMember is on by default (LD10) and a saved toggle off wins", async () => {
    signInAs("admin");
    expect((await add({ oid: PEOPLE.alice.oid })).res.status).toBe(201);
    await setToggles({ addTeamMember: false });
    await expectError(
      (await add({ oid: PEOPLE.bob.oid })).res,
      403,
      "OPERATION_DISABLED",
    );
  });
});
