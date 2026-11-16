import { vi, describe, expect, it, beforeEach } from "vitest";

import { ctxAt, ok } from "@/lib/data/access/access-test-support";
import { putIdentityLink } from "@/lib/data/access/identity-links";
import { createFakeLiteLLM } from "@/test/fake-litellm";
import type { FakeCall } from "@/test/fake-litellm";
import {
  LTEAM,
  call,
  enterProd,
  expectError,
  expectNoSentinels,
  setToggles,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
  useEnv,
  viewsHandler,
} from "@/test/fake-litellm-views";
import { PEOPLE, seedIdentity, seedMember } from "@/test/matrix-route-support";
import { signInAs } from "@/test/scope-fixtures";
import type { CallerName } from "@/test/scope-fixtures";

// Source: docs/specs/2026-11-10-litellm.md - "Identity mapping and members"
// ("Removing a dashboard membership never changes LiteLLM ... Settings lists
// such orphaned LiteLLM members"), "API routes" (/api/litellm/orphans GET
// Admin, Auditor; org-admin is NOT listed, LD24 adds org-admin to the config
// views only), "Reads" (getTeam), LD23 (orphans are identities only), LD19
// (toggles), LT11 (open mode), Rules 10.3, 60.23, 60.24a. The 401, no-store and
// header cases for every caller are the shared route-contract suite's.
//
// Contract for the developer (.../orphans/route.ts, GET, no query):
//   200 data = { items: [{ teamId, teamName, litellmUserId, email, name? }] }
//   - teamId/teamName: the DASHBOARD team (AccountMeta.teamName).
//   - one row per (linked team, LiteLLM member) whose person is not a
//     dashboard member of that team; matched by the member's stored
//     IdentityLink.litellmUserId, else by lower-cased email (identity email or
//     usage identity), as mapTeamMembers does.
//   - sorted by teamName, then email. Teams without a link are skipped (no
//     LiteLLM call). No spend, budget or limits, ever.
//   Admin and Auditor only; any other signed-in caller: 403 FORBIDDEN before
//   any LiteLLM call. Outage 503 LITELLM_UNAVAILABLE; getTeam toggle off 403
//   OPERATION_DISABLED; AUTH_ACCESS_MODE=open 403 OPERATION_UNAVAILABLE.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

type LMember = { id: string; email: string };
// LiteLLM-side members per dashboard team id (the fake answers GET /team/info
// per LiteLLM team id). Every membership row carries spend and a budget table
// so a leak of either would show.
const LITELLM_MEMBERS: Record<string, LMember[]> = {
  // memberA (link a1@company.com) and Bob (email only): dashboard members.
  "team-a": [
    { id: "a1@company.com", email: "a1@company.com" },
    { id: "bob@company.com", email: "bob@company.com" },
    { id: "zed@company.com", email: "zed@company.com" },
  ],
  // Dave: dashboard member matched by lower-cased email, upstream id differs.
  "team-b": [{ id: "uid-dave", email: "Dave@Company.com" }],
  // Carol: dashboard member matched by link only (emails differ); two orphans
  // listed out of order.
  "team-c": [
    { id: "uid-carol", email: "carol.alt@other.com" },
    { id: "amy@company.com", email: "amy@company.com" },
    { id: "abe@company.com", email: "abe@company.com" },
  ],
  // Carol is not a dashboard member of team-m: the same person is an orphan here.
  "team-m": [{ id: "uid-carol", email: "carol.alt@other.com" }],
};

const state = setupViewsSuite();

function installOrphanFake(opts: { outage?: boolean } = {}) {
  const base = viewsHandler({ outage: opts.outage });
  const byLiteLLMId = new Map(
    Object.entries(LITELLM_MEMBERS).map(([team, rows]) => [
      LTEAM[team as keyof typeof LTEAM] as string,
      rows,
    ]),
  );
  state.fake = createFakeLiteLLM((c: FakeCall, attempt: number) => {
    const reply = base(c, attempt);
    if (typeof reply === "string") return reply;
    if (`${c.method} ${c.path}` !== "GET /team/info") return reply;
    const id = new URL(c.url).searchParams.get("team_id") ?? "";
    const rows = byLiteLLMId.get(id) ?? [];
    const payload = reply.body as { team_info: Record<string, unknown> };
    return {
      status: reply.status,
      body: {
        ...payload,
        team_info: {
          ...payload.team_info,
          members_with_roles: rows.map((m) => ({
            user_id: m.id,
            user_email: m.email,
            role: "user",
          })),
        },
        team_memberships: rows.map((m) => ({
          user_id: m.id,
          team_id: id,
          spend: 77.5,
          budget_id: "b1",
          internal_note: "MEMBERSHIP-SENTINEL",
          litellm_budget_table: { max_budget: 9, rpm_limit: 5, tpm_limit: 50 },
        })),
      },
    };
  });
  vi.stubGlobal("fetch", state.fake.fetch);
}

beforeEach(async () => {
  for (const p of [PEOPLE.alice, PEOPLE.bob, PEOPLE.carol, PEOPLE.dave]) {
    await seedIdentity(p.oid, { email: p.email, name: p.name });
  }
  await seedMember(PEOPLE.bob.oid, "team-a");
  await seedMember(PEOPLE.dave.oid, "team-b");
  await seedMember(PEOPLE.carol.oid, "team-c");
  ok(
    await putIdentityLink(
      {
        oid: PEOPLE.carol.oid,
        usageIdentities: [PEOPLE.carol.email],
        aliases: [],
        litellmUserId: "uid-carol",
        version: null,
      },
      ctxAt(undefined, "req-link-carol"),
    ),
  );
  installOrphanFake();
});

const get = async () => {
  stubLiteLLMEnv();
  const { GET } = await import("./route");
  return call(GET, "/api/litellm/orphans");
};

describe("GET /api/litellm/orphans", () => {
  it("lists LiteLLM team members who are not dashboard members of the linked team, one row per (team, person), sorted by team name then email (Identity mapping and members)", async () => {
    signInAs("admin");
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(
      body.data.items.map(
        (r: { teamId: string; teamName: string; email: string }) => [
          r.teamId,
          r.teamName,
          r.email,
        ],
      ),
    ).toEqual([
      ["team-a", "A", "zed@company.com"],
      ["team-c", "C", "abe@company.com"],
      ["team-c", "C", "amy@company.com"],
      ["team-m", "M", "carol.alt@other.com"],
    ]);
    const carol = body.data.items.find(
      (r: { teamId: string }) => r.teamId === "team-m",
    );
    expect(carol.litellmUserId).toBe("uid-carol");
  });

  it("matches a dashboard member by stored litellmUserId, else by lower-cased email: Carol (link) and Dave (email) in their own teams are not orphans", async () => {
    signInAs("admin");
    const { body } = await get();
    const rows = body.data.items as Array<{ teamId: string; email: string }>;
    expect(rows.some((r) => r.teamId === "team-b")).toBe(false);
    expect(
      rows.some((r) => r.teamId === "team-c" && r.email.includes("carol")),
    ).toBe(false);
    expect(rows.some((r) => r.email === "bob@company.com")).toBe(false);
    expect(rows.some((r) => r.email === "a1@company.com")).toBe(false);
  });

  it("rows are identities only: no spend, budget or limits, and no loose upstream fields (LD23; LT1)", async () => {
    signInAs("admin");
    const { body } = await get();
    expect(Object.keys(body.data)).toEqual(["items"]);
    const allowed = new Set([
      "teamId",
      "teamName",
      "litellmUserId",
      "email",
      "name",
    ]);
    for (const row of body.data.items) {
      expect(Object.keys(row).every((k) => allowed.has(k))).toBe(true);
    }
    expect(JSON.stringify(body)).not.toMatch(/77\.5|spend|budget|limit/i);
    expectNoSentinels(body);
  });

  it("is unchanged by the Organisation cap: identities only, so a capped caller sees the same rows (LD23)", async () => {
    await enterProd();
    signInAs("admin");
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(body.data.items).toHaveLength(4);
  });

  it("reads each linked team once and skips teams without a link (team-u): no call for an unlinked team (Identity mapping)", async () => {
    signInAs("admin");
    await get();
    const infoCalls = state.fake.calls.filter((c) => c.path === "/team/info");
    expect(infoCalls).toHaveLength(Object.keys(LTEAM).length);
    expect(state.fake.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it.each([
    ["admin", true],
    ["auditor", true],
    ["orgAdmin", false],
    ["teamAdminA", false],
    ["deptAdminEng", false],
    ["memberA", false],
    ["viewerNone", false],
  ] as Array<[CallerName, boolean]>)(
    "%s -> allowed: %s (API routes: Admin, Auditor)",
    async (who, allowed) => {
      signInAs(who);
      const { res, body } = await get();
      if (allowed) {
        expect(res.status).toBe(200);
        expect(body.data.items).toHaveLength(4);
      } else {
        await expectError(res, 403, "FORBIDDEN");
        expect(state.fake.calls).toHaveLength(0);
      }
    },
  );

  it("a signed-in caller with no role is 403 FORBIDDEN before any LiteLLM call (Rule 10.3)", async () => {
    await signInWithRoles([]);
    const { res } = await get();
    await expectError(res, 403, "FORBIDDEN");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE without upstream detail (error codes; LT12)", async () => {
    installOrphanFake({ outage: true });
    signInAs("admin");
    const { res, text } = await get();
    await expectError(res, 503, "LITELLM_UNAVAILABLE");
    expect(text).not.toContain("fetch failed");
  });

  it("a disabled getTeam read is 403 OPERATION_DISABLED before any LiteLLM call (Toggles narrow only; LD19)", async () => {
    await setToggles({ getTeam: false });
    signInAs("admin");
    const { res } = await get();
    await expectError(res, 403, "OPERATION_DISABLED");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("open access mode is 403 OPERATION_UNAVAILABLE (LT11)", async () => {
    signInAs("admin");
    useEnv({ AUTH_ACCESS_MODE: "open" });
    const { res } = await get();
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
  });
});
