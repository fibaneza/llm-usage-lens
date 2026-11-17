import { MemberSumSchema } from "@llm-usage-lens/shared";
import { describe, expect, it, vi } from "vitest";

import { getIdentityLink } from "@/lib/data/access/identity-links";
import {
  setToggles,
  setupViewsSuite,
  stubLiteLLMEnv,
} from "@/test/fakes/fake-litellm-views";
import {
  SCENARIO,
  SCENARIO_FAKE,
  installMemberSumFake,
  seedBoundMember,
  seedLinkedMembers,
  seedScenario,
  seedUnlinkedTeam,
  userDailyCalls,
  userIdsRead,
} from "@/test/support/member-sum-support";

// Source: docs/specs/2026-11-17-app-teams.md - "Member sum" steps 1-7 (members
// are the bound affiliations, pending counted not summed; LiteLLM user is the
// stored link else findUserByEmail on the verified email; getUserDailySpend
// with timezone=0, rows added per UTC day; coverage; 5 concurrent reads, 200
// members; any failed read fails the sum; toggles), "Organisation cap" (AT3),
// AT6, AT7, ATT2, ATT3. LiteLLM spec LD13, LD20.
//
// Contract for the developer (apps/dashboard/lib/litellm/member-sum.ts,
// server-only):
//   computeMemberSum({ teamId, startDate, endDate, perUserCostHidden })
//     -> { total, daily: [{ date, spend }],
//          coverage: { members, matched, unmatched, pending },
//          members: [{ oid, name?, matched, spend? }] }   (MemberSumSchema)
//   `members` = bound affiliations (= matched + unmatched); pending items are
//   only counted. An unmatched member has no `spend`. With perUserCostHidden
//   no member row carries `spend`; total and daily are still present.
//   Rejects with an error whose `code` is "TOO_MANY_MEMBERS" above 200
//   members (before any LiteLLM call); a failed member read rejects with the
//   LiteLLM error (no partial sum); a disabled getUserDailySpend rejects with
//   LiteLLMOperationRefused ("OPERATION_DISABLED").
// The shared views harness reaches @/auth through the scope fixtures; the sum
// itself takes no session.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupViewsSuite();

type Input = {
  teamId: string;
  startDate: string;
  endDate: string;
  perUserCostHidden: boolean;
};
const RANGE = { startDate: "2026-11-01", endDate: "2026-11-14" };

async function sum(over: Partial<Input> = {}) {
  stubLiteLLMEnv();
  const { computeMemberSum } = await import("./member-sum");
  return computeMemberSum({
    teamId: SCENARIO.teamId,
    ...RANGE,
    perUserCostHidden: false,
    ...over,
  });
}

const memberOf = (
  result: Awaited<ReturnType<typeof sum>>,
  oid: string,
): { oid: string; name?: string; matched: boolean; spend?: number } =>
  result.members.find((m: { oid: string }) => m.oid === oid)!;

describe("computeMemberSum (App Teams - Member sum)", () => {
  it("adds each matched member's UTC days; the total is the sum of the days and of the member rows (steps 3, 4)", async () => {
    await seedScenario();
    installMemberSumFake(state, SCENARIO_FAKE);
    const result = await sum();
    expect(MemberSumSchema.safeParse(result).success).toBe(true);
    expect(result.daily).toEqual(SCENARIO.daily);
    expect(result.total).toBe(SCENARIO.total);
    expect(result.daily.reduce((a, d) => a + d.spend, 0)).toBe(result.total);
    expect(memberOf(result, SCENARIO.u1.oid)).toMatchObject({
      name: "Una One",
      matched: true,
      spend: 3.5,
    });
    expect(memberOf(result, SCENARIO.u2.oid)).toMatchObject({
      matched: true,
      spend: 0.5,
    });
  });

  it("counts matched, unmatched and pending; an unmatched member has no spend, never $0 (step 4)", async () => {
    await seedScenario();
    installMemberSumFake(state, SCENARIO_FAKE);
    const result = await sum();
    expect(result.coverage).toEqual(SCENARIO.coverage);
    const lost = memberOf(result, SCENARIO.u3.oid);
    expect(lost.matched).toBe(false);
    expect(lost).not.toHaveProperty("spend");
    expect(result.members).toHaveLength(3);
  });

  it("a team with no members is a zero sum with no LiteLLM call (step 1)", async () => {
    installMemberSumFake(state);
    const result = await sum({ teamId: "team-c" });
    expect(result).toMatchObject({
      total: 0,
      daily: [],
      coverage: { members: 0, matched: 0, unmatched: 0, pending: 0 },
      members: [],
    });
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a member with a matched user and no spend in the range is matched with $0 (step 4: only unmatched is never $0)", async () => {
    await seedScenario();
    installMemberSumFake(state, { ...SCENARIO_FAKE, daily: {} });
    const result = await sum();
    expect(memberOf(result, SCENARIO.u1.oid)).toMatchObject({
      matched: true,
      spend: 0,
    });
    expect(result.total).toBe(0);
    expect(result.daily).toEqual([]);
  });

  describe("LiteLLM user for each member (step 2; ATT2; LD13)", () => {
    it("uses the stored link and looks up only the members without one, by verified email, never composing an id", async () => {
      await seedScenario();
      installMemberSumFake(state, SCENARIO_FAKE);
      await sum();
      const lookups = state.fake.calls
        .filter((c) => c.path === "/user/list")
        .map((c) => new URL(c.url).searchParams.get("user_email"))
        .sort();
      expect(lookups).toEqual([SCENARIO.u2.email, SCENARIO.u3.email]);
      expect(userIdsRead(state)).toEqual(
        [SCENARIO.luserU1, SCENARIO.luserU2].sort(),
      );
    });

    it("writes no identity link for a member found by email (step 2: no link is written)", async () => {
      await seedScenario();
      installMemberSumFake(state, SCENARIO_FAKE);
      await sum();
      expect(await getIdentityLink(SCENARIO.u2.oid)).toBeNull();
    });

    it("drops a lookup result that carries another email: the member is unmatched and that user is never read (ATT2)", async () => {
      await seedScenario();
      installMemberSumFake(state, {
        ...SCENARIO_FAKE,
        daily: {
          ...SCENARIO_FAKE.daily,
          "uid-someone-else": [{ date: "2026-11-02", spend: 99 }],
        },
        emailLookup: {
          [SCENARIO.u2.email]: {
            user_id: "uid-someone-else",
            user_email: "someone.else@company.com",
          },
          [SCENARIO.u3.email]: null,
        },
      });
      const result = await sum();
      expect(memberOf(result, SCENARIO.u2.oid).matched).toBe(false);
      expect(userIdsRead(state)).not.toContain("uid-someone-else");
      expect(result.total).toBe(3.5);
      expect(result.coverage).toMatchObject({ matched: 1, unmatched: 2 });
    });

    it("a member without a stored link or a verified email is unmatched and costs no LiteLLM call (step 2)", async () => {
      await seedBoundMember("team-u", { oid: "oid-bare" });
      installMemberSumFake(state);
      const result = await sum();
      expect(memberOf(result, "oid-bare").matched).toBe(false);
      expect(state.fake.calls).toHaveLength(0);
    });
  });

  it("reads each member's daily spend in UTC for the range with timezone=0 (step 3; LD20)", async () => {
    await seedScenario();
    installMemberSumFake(state, SCENARIO_FAKE);
    await sum();
    for (const call of userDailyCalls(state)) {
      const q = new URL(call.url).searchParams;
      expect(q.get("timezone")).toBe("0");
      expect(q.get("start_date")).toBe("2026-11-01");
      expect(q.get("end_date")).toBe("2026-11-14");
    }
    expect(userDailyCalls(state)).toHaveLength(2);
  });

  describe("bounds (step 5; AT6; ATT3)", () => {
    it("runs at most 5 LiteLLM reads at once and reads every member", async () => {
      const ids = await seedLinkedMembers("team-u", 12);
      const tracker = installMemberSumFake(state);
      await sum();
      expect(tracker.max).toBeLessThanOrEqual(5);
      expect(userIdsRead(state)).toEqual([...ids].sort());
    });

    it("200 members are summed", async () => {
      await seedLinkedMembers("team-u", 200);
      installMemberSumFake(state);
      const result = await sum();
      expect(result.coverage).toMatchObject({ members: 200, matched: 200 });
      expect(userDailyCalls(state)).toHaveLength(200);
    });

    it("201 members reject with TOO_MANY_MEMBERS before any LiteLLM call (ATT3)", async () => {
      for (let n = 1; n <= 201; n += 1) {
        await seedBoundMember("team-u", {
          oid: `oid-many-${n}`,
          litellmUserId: `lu-many-${n}`,
        });
      }
      installMemberSumFake(state);
      await expect(sum()).rejects.toMatchObject({ code: "TOO_MANY_MEMBERS" });
      expect(state.fake.calls).toHaveLength(0);
    });
  });

  describe("failure (step 6; AT7; Rule 60.17)", () => {
    it("one failing member read rejects the whole sum, never a partial one", async () => {
      await seedScenario();
      installMemberSumFake(state, {
        ...SCENARIO_FAKE,
        failUsers: [SCENARIO.luserU2],
      });
      await expect(sum()).rejects.toMatchObject({
        code: "LITELLM_UNAVAILABLE",
      });
    });
  });

  describe("toggles (step 7)", () => {
    it("a disabled getUserDailySpend rejects with OPERATION_DISABLED and reads no member", async () => {
      await seedScenario();
      await setToggles({ getUserDailySpend: false });
      installMemberSumFake(state, SCENARIO_FAKE);
      await expect(sum()).rejects.toMatchObject({
        code: "OPERATION_DISABLED",
      });
      expect(userDailyCalls(state)).toHaveLength(0);
    });
  });

  describe("Organisation cap (AT3; LD23)", () => {
    it("member rows carry no spend while the cap holds, but the total, the days and the coverage are present", async () => {
      await seedScenario();
      installMemberSumFake(state, SCENARIO_FAKE);
      const result = await sum({ perUserCostHidden: true });
      expect(result.total).toBe(SCENARIO.total);
      expect(result.daily).toEqual(SCENARIO.daily);
      expect(result.coverage).toEqual(SCENARIO.coverage);
      for (const m of result.members) expect(m).not.toHaveProperty("spend");
      expect(memberOf(result, SCENARIO.u1.oid).matched).toBe(true);
    });

    it("the total is shown for a team of one member too (AT3: always show it)", async () => {
      await seedUnlinkedTeam("team-solo", 6);
      await seedBoundMember("team-solo", {
        oid: "oid-solo",
        litellmUserId: "lu-solo",
      });
      installMemberSumFake(state, {
        daily: { "lu-solo": [{ date: "2026-11-02", spend: 7 }] },
      });
      const result = await sum({
        teamId: "team-solo",
        perUserCostHidden: true,
      });
      expect(result.total).toBe(7);
      expect(result.members[0]).not.toHaveProperty("spend");
    });
  });
});
