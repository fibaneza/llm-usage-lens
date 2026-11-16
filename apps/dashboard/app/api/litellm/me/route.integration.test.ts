import { describe, expect, it, vi } from "vitest";

import {
  LUSER,
  OTHER_USER_ID,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
  UNLINKED_LTEAM,
  DATES,
  call,
  expectError,
  expectNoSentinels,
  installFake,
  seedViews,
  setToggles,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
  useEnv,
} from "@/test/fakes/fake-litellm-views";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { grantRole } from "@/lib/data/access/role-grants";
import { installFakeOtel, recordedSpans } from "@/test/fakes/otel-fake";
import { CALLERS, signInAs } from "@/test/fixtures/scope-fixtures";
import { clearTable } from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/me GET,
// any signed-in role, own data), "Roles and rights" (Viewer: through their
// litellmUserId link, empty state if unlinked; own spend, budget, limits and
// own keys' metadata, never key values), "Reads" (getUser: user_id required,
// keys and teams filtered to the caller's scope; getUserDailySpend
// timezone=0, LD20), threats LT1, LT9, implementation-phases L3 Verify, Rule 60.23.
//
// Contract for the developer (.../me/route.ts, GET):
//   query: dateFrom, dateTo (90-day cap -> 400). No user-id input exists.
//   200 data = { linked: false } when the caller has no litellmUserId, with no LiteLLM call, else
//   An unlinked caller is resolved with findUserByEmail(session email) and, when found,
//   gets the same linked:true payload; when not found { linked: false }. Read only.
//   { linked: true, spend, maxBudget, daily: [{ date, spend, ... }],
//     keys: [{ tokenId, keyAlias, blocked, expires, models, spend, maxBudget, ... }],
//     enabledOperations: string[] }.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupViewsSuite();
const load = async () => {
  stubLiteLLMEnv();
  return (await import("./route")).GET;
};
const me = async (query = `?${DATES}`) =>
  call(await load(), `/api/litellm/me${query}`);

describe("GET /api/litellm/me", () => {
  it("401 without a session, no-store (Rule 10.3)", async () => {
    signInAs(null);
    const { res } = await me();
    await expectError(res, 401, "UNAUTHORIZED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it.each(["auditor", "admin"] as const)(
    "%s with no stored link and no LiteLLM user for their email gets the empty 'unlinked' state; the only call is the email lookup (Views: Own usage without a stored link)",
    async (who) => {
      signInAs(who);
      const { res, body } = await me();
      expect(res.status).toBe(200);
      expect(body.data.linked).toBe(false);
      expect(state.fake.calls.map((c) => c.path)).toEqual(["/user/list"]);
    },
  );

  it("a session with no role reads its own (empty) data: any signed-in role (API routes)", async () => {
    await signInWithRoles([]);
    const { res, body } = await me();
    expect(res.status).toBe(200);
    expect(body.data.linked).toBe(false);
  });

  it("an unlinked caller is resolved by findUserByEmail on the session email and reads that user's usage (Views: Own usage without a stored link; LD13)", async () => {
    signInAs("teamAdminA"); // ta@company.com: no IdentityLink; LiteLLM id is uid-ta-0001
    const { res, body } = await me();
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ linked: true, spend: 1, maxBudget: 5 });
    const list = state.fake.calls.find((c) => c.path === "/user/list")!;
    expect(new URL(list.url).searchParams.get("user_email")).toBe(
      "ta@company.com",
    );
    // The id LiteLLM returned is used, never one composed from the email.
    const userIds = state.fake.calls
      .filter(
        (c) => c.path === "/user/info" || c.path === "/user/daily/activity",
      )
      .map((c) => new URL(c.url).searchParams.get("user_id"));
    expect(userIds).toEqual(expect.arrayContaining(["uid-ta-0001"]));
    expect(new Set(userIds)).toEqual(new Set(["uid-ta-0001"]));
  });

  it("an unlinked caller whose session email fails the gateway's email schema gets the normal unlinked payload, not a 500, and no /user/list call (Rule 60.17; Views: Own usage without a stored link)", async () => {
    signInAs("teamAdminA", "not-an-email");
    const { res, body } = await me();
    expect(res.status).toBe(200);
    expect(body.data.linked).toBe(false);
    expect(state.fake.calls.some((c) => c.path === "/user/list")).toBe(false);
  });

  // Rule 60.17: a swallowed LiteLLMError must still reach OpenTelemetry.
  // Contract: addEvent("litellm.find_user_by_email_failed") on the active span.
  it("an unlinked caller whose email lookup throws LiteLLMError still gets 200 unlinked and the failure is recorded as a span event (Rule 60.17)", async () => {
    installFakeOtel();
    installFake(state, { outage: true });
    signInAs("teamAdminA");
    const before = recordedSpans.length;
    const { res, body } = await me();
    expect(res.status).toBe(200);
    expect(body.data.linked).toBe(false);
    const events = recordedSpans
      .slice(before)
      .flatMap((s) => s.events.map((e) => e.name));
    expect(events).toContain("litellm.find_user_by_email_failed");
  });

  it("the fallback is read only: it writes no IdentityLink (Views: Own usage without a stored link)", async () => {
    signInAs("teamAdminA");
    await me();
    const { getIdentityLink } =
      await import("@/lib/data/access/identity-links");
    expect(await getIdentityLink(CALLERS.teamAdminA.oid)).toBeNull();
  });

  it("a stored link wins: no email lookup is made for a linked caller (Views: Own usage)", async () => {
    signInAs("memberA");
    await me();
    expect(state.fake.calls.some((c) => c.path === "/user/list")).toBe(false);
  });

  it("a Viewer reads only their own LiteLLM user, never another (Viewer own vs other)", async () => {
    signInAs("memberA");
    const a = await me();
    expect(a.body.data.spend).toBe(7.5);
    const infoA = state.fake.calls.filter((c) => c.path === "/user/info");
    expect(
      infoA.map((c) => new URL(c.url).searchParams.get("user_id")),
    ).toEqual([LUSER.memberA]);
    installFake(state);
    signInAs("memberB");
    await me();
    const ids = state.fake.calls
      .filter(
        (c) => c.path === "/user/info" || c.path === "/user/daily/activity",
      )
      .map((c) => new URL(c.url).searchParams.get("user_id"));
    expect(new Set(ids)).toEqual(new Set([LUSER.memberB]));
  });

  it("a user id in the query is ignored: the identity link is the only source (LT5 class)", async () => {
    signInAs("memberA");
    await me(`?${DATES}&userId=${LUSER.memberB}&user_id=${OTHER_USER_ID}`);
    const ids = state.fake.calls.map((c) =>
      new URL(c.url).searchParams.get("user_id"),
    );
    expect(ids).not.toContain(LUSER.memberB);
    expect(ids).not.toContain(OTHER_USER_ID);
  });

  it("returns own spend, budget and only own keys' metadata, filtered to the caller's scope (Reads: getUser)", async () => {
    signInAs("memberA");
    const { body } = await me();
    expect(body.data).toMatchObject({
      linked: true,
      spend: 7.5,
      maxBudget: 20,
    });
    const tokens = body.data.keys.map((k: { tokenId: string }) => k.tokenId);
    // TOKEN_B belongs to another person; TOKEN_C to a team the dashboard does not link.
    expect(tokens).toEqual([TOKEN_A]);
    expect(tokens).not.toContain(TOKEN_B);
    expect(tokens).not.toContain(TOKEN_C);
    expect(JSON.stringify(body)).not.toContain(UNLINKED_LTEAM);
  });

  it("never returns a key value; loose team rows are dropped or reduced (LT1, LT9; reduction)", async () => {
    signInAs("memberA");
    const { body, text } = await me();
    expectNoSentinels(body);
    expect(text).not.toMatch(/sk-/);
    for (const k of body.data.keys) expect(k).not.toHaveProperty("key");
  });

  it("daily activity is queried for the linked user in UTC with timezone=0 (LD20)", async () => {
    signInAs("memberA");
    await me();
    const daily = state.fake.calls.find(
      (c) => c.path === "/user/daily/activity",
    )!;
    const q = new URL(daily.url).searchParams;
    expect(q.get("timezone")).toBe("0");
    expect(q.get("user_id")).toBe(LUSER.memberA);
    expect(q.get("start_date")).toBe("2026-11-01");
    expect(q.get("end_date")).toBe("2026-11-14");
  });

  it("reports the caller's enabledOperations (Toggles narrow only)", async () => {
    signInAs("memberA");
    const { body } = await me();
    expect(body.data.enabledOperations).toContain("getUser");
  });

  it("a disabled getUser is 403 OPERATION_DISABLED before any LiteLLM call (LD19)", async () => {
    await setToggles({ getUser: false });
    signInAs("memberA");
    const { res } = await me();
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE (error codes)", async () => {
    installFake(state, { outage: true });
    signInAs("memberA");
    const { res, text } = await me();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
  });

  // Source: docs/specs/2026-11-10-litellm.md "Views by role" (Own usage
  // without a stored link; the teams a caller may open come from DynamoDB),
  // error codes. Decision: for an UNLINKED caller a LiteLLM failure on the
  // email lookup degrades to 200 { linked: false, teams, enabledOperations }
  // (same payload as "no match"); `teams` never depends on LiteLLM.
  it("an unlinked caller keeps their teams when the email lookup fails (LiteLLM outage)", async () => {
    installFake(state, { outage: true });
    signInAs("teamAdminA");
    const { res, body } = await me();
    expect(res.status).toBe(200);
    expect(body.data.linked).toBe(false);
    expect(body.data.teams.map((t: { teamId: string }) => t.teamId)).toContain(
      "team-a",
    );
  });

  it("no stored connection is 503 LITELLM_UNAVAILABLE for a linked caller (error codes: not configured)", async () => {
    await clearTable();
    await seedViews({ connection: false });
    signInAs("memberA");
    const { res } = await me();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE (LT11)", async () => {
    useEnv({ AUTH_ACCESS_MODE: "open" });
    signInAs("memberA");
    const { res } = await me();
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
  });

  it("400 BAD_REQUEST for a range over 90 days, no LiteLLM call (Rule 20.8)", async () => {
    signInAs("memberA");
    const { res } = await me("?dateFrom=2026-01-01&dateTo=2026-06-01");
    await expectError(res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  // B4: a bare call must never 400 (Rule 20.1, 20.8; LD20). The default is the
  // app's standard range, defaultDateRange (30 UTC days ending today); the
  // clock is frozen at 2026-11-14.
  it("no dateFrom/dateTo defaults to the last 30 UTC days ending today, not 400 (Rule 20.1)", async () => {
    signInAs("memberA");
    const { res } = await me("");
    expect(res.status).toBe(200);
    const daily = state.fake.calls.find(
      (c) => c.path === "/user/daily/activity",
    )!;
    const q = new URL(daily.url).searchParams;
    expect(q.get("start_date")).toBe("2026-10-16");
    expect(q.get("end_date")).toBe("2026-11-14");
    expect(q.get("timezone")).toBe("0");
  });

  it("an explicit valid range is honoured, not replaced by the default (Rule 20.8)", async () => {
    signInAs("memberA");
    const { res } = await me("?dateFrom=2026-09-01&dateTo=2026-09-10");
    expect(res.status).toBe(200);
    const daily = state.fake.calls.find(
      (c) => c.path === "/user/daily/activity",
    )!;
    const q = new URL(daily.url).searchParams;
    expect(q.get("start_date")).toBe("2026-09-01");
    expect(q.get("end_date")).toBe("2026-09-10");
  });

  it("a lone dateFrom or dateTo is a 400, not a half default (Rule 20.8)", async () => {
    signInAs("memberA");
    const { res } = await me("?dateFrom=2026-11-01");
    await expectError(res, 400, "BAD_REQUEST");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a 200 carries Cache-Control private, no-store (API routes)", async () => {
    signInAs("memberA");
    const { res } = await me();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

// Source: docs/specs/2026-11-10-litellm.md -- "Team configuration page (L4)"
// (Who: a Lead for the teams in its scope, internal-org-admin and
// internal-admin; the Auditor, Viewers and plain members get no page; entry
// link only for callers who can open it), LD25; Access Control -- Roles, Rule
// 50.4 (stored grants count). Contract: each `teams[]` entry carries an
// optional boolean `configurable`, computed on the server per request; absent
// means false.
describe("GET /api/litellm/me teams[].configurable (Team configuration page: Who)", () => {
  type TeamRow = { teamId: string; configurable?: boolean };
  const teamsOf = async (): Promise<TeamRow[]> => {
    const { res, body } = await me();
    expect(res.status).toBe(200);
    return body.data.teams;
  };
  const flag = (rows: TeamRow[], id: string) =>
    rows.find((t) => t.teamId === id)?.configurable ?? false;

  it("a team-scope Lead can configure its own team only", async () => {
    signInAs("teamAdminA");
    const rows = await teamsOf();
    expect(flag(rows, "team-a")).toBe(true);
    expect(rows.filter((t) => t.configurable).map((t) => t.teamId)).toEqual([
      "team-a",
    ]);
  });

  it("a department-scope Lead can configure the teams of its department, not other departments' teams", async () => {
    signInAs("deptAdminEng");
    const rows = await teamsOf();
    expect(flag(rows, "team-a")).toBe(true);
    expect(flag(rows, "team-b")).toBe(true);
    expect(flag(rows, "team-c")).toBe(false);
  });

  it.each(["orgAdmin", "admin"] as const)(
    "%s can configure every team they are shown",
    async (who) => {
      signInAs(who);
      const rows = await teamsOf();
      expect(rows.length).toBeGreaterThanOrEqual(4);
      expect(rows.every((t) => t.configurable === true)).toBe(true);
    },
  );

  it("a stored internal-org-admin grant on a viewer claim counts (Rule 50.4)", async () => {
    ok(
      await grantRole(
        {
          oid: "00000000-0000-4000-8000-0000000009ff",
          role: "internal-org-admin",
          reason: "test",
        },
        ctxAt(undefined, "req-grant-config"),
      ),
    );
    await signInWithRoles(["internal-viewer"]);
    const rows = await teamsOf();
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((t) => t.configurable === true)).toBe(true);
  });

  it("the Auditor sees teams but can configure none (user direction: no page)", async () => {
    signInAs("auditor");
    const rows = await teamsOf();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((t) => t.configurable === true)).toBe(false);
  });

  it("a Viewer who is a plain member of a team can configure none (a member-only team is not even listed)", async () => {
    signInAs("memberA");
    const rows = await teamsOf();
    expect(rows.some((t) => t.configurable === true)).toBe(false);
  });
});
