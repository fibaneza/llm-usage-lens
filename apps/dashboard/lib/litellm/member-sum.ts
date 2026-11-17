import "server-only";

import { runBounded } from "@llm-usage-lens/shared";
import type { MemberSumSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { getIdentityLink } from "@/lib/data/access/identity-links";
import {
  countPendingAffiliations,
  getIdentityRecord,
  listAllTeamMemberOids,
} from "@/lib/data/access/team-member-lookup";

import { MemberSumTooManyMembers } from "./member-sum-error";
import {
  findUserByEmail,
  getUserDailySpend,
  USER_DAILY_PAGE_CAP,
} from "./operations";
import { enabledOperations, reduceDaily, requireEnabled } from "./read-views";
import { runBoundedSettled } from "./run-settled";

// Source: docs/specs/2026-11-17-app-teams.md - "Member sum" steps 1-7, AT3,
// AT6, AT7, ATT2; LiteLLM spec LD13 (the user id is read from LiteLLM, never
// composed), LD20 (timezone=0), LD23 (Organisation cap).

export { MemberSumTooManyMembers };

export const MAX_MEMBERS = 200;
// getUserDailySpend reads at most this many pages (operations.ts), so one
// member costs at most one email lookup plus this many calls (LD34).
export const MAX_CALLS_PER_MEMBER = USER_DAILY_PAGE_CAP + 1;
const MAX_CONCURRENT_READS = 5;

const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

type MemberSum = z.infer<typeof MemberSumSchema>;
type Member = MemberSum["members"][number];

// The request-wide LiteLLM call budget (LD34). Each member's worst case is
// reserved before its reads and the unused part is returned after, so the
// request never exceeds the budget however many pages a member's spend has.
export type CallBudget = { remaining: number };

export class MemberSumOverBudget extends Error {
  constructor() {
    super("The LiteLLM call budget cannot cover this team");
    this.name = "MemberSumOverBudget";
  }
}

export type MemberSumInput = {
  teamId: string;
  startDate: string;
  endDate: string;
  perUserCostHidden: boolean;
  // The membership the caller already read; when given it is not read again.
  memberOids?: string[];
  // When given, the sum throws MemberSumOverBudget instead of exceeding it.
  budget?: CallBudget;
  // A caller running other reads beside the sum turns this true when one of
  // them fails: no member read starts after that, and the sum settles (LT25).
  halt?: { stopped: boolean };
};

type Resolved = {
  oid: string;
  name: string | undefined;
  litellmUserId: string | null;
  lookedUp: boolean;
};

// The stored link, else the user LiteLLM returns for the identity's verified
// email; a result carrying another email is dropped (ATT2). No link written.
async function resolve(
  oid: string,
  canLookUp: boolean,
  stopped: () => boolean,
): Promise<Resolved> {
  const [link, identity] = await Promise.all([
    getIdentityLink(oid),
    getIdentityRecord(oid),
  ]);
  const name = identity?.displayName;
  if (link?.litellmUserId) {
    return { oid, name, litellmUserId: link.litellmUserId, lookedUp: false };
  }
  const parsed = EmailSchema.safeParse(identity?.email);
  if (!canLookUp || !parsed.success || stopped()) {
    return { oid, name, litellmUserId: null, lookedUp: false };
  }
  const email = parsed.data;
  const { users } = await findUserByEmail({ email });
  const found = users.find((u) => u.user_email?.toLowerCase() === email);
  return {
    oid,
    name,
    litellmUserId: found?.user_id ?? null,
    lookedUp: true,
  };
}

// LiteLLM calls the sum of these members can make at most: one spend read per
// member plus one email lookup for each member without a stored link (LD34).
export async function worstCaseCalls(oids: string[]): Promise<number> {
  let calls = 0;
  await runBounded(oids, MAX_CONCURRENT_READS, async (oid) => {
    const link = await getIdentityLink(oid);
    calls += link?.litellmUserId ? 1 : 2;
  });
  return calls;
}

export async function computeMemberSum(
  input: MemberSumInput,
): Promise<MemberSum> {
  const oids = input.memberOids ?? (await listAllTeamMemberOids(input.teamId));
  if (oids.length > MAX_MEMBERS) throw new MemberSumTooManyMembers(oids.length);
  const enabled = await enabledOperations();
  requireEnabled(enabled, ["getUserDailySpend"]);
  const canLookUp = enabled.includes("findUserByEmail");
  const pending = await countPendingAffiliations(input.teamId);

  const resolved = new Map<string, Resolved>();
  const spendByOid = new Map<string, number>();
  const byDay = new Map<string, number>();
  const budget = input.budget;
  const waiting = { inFlight: 0, wake: [] as Array<() => void> };
  await runBoundedSettled(oids, MAX_CONCURRENT_READS, async (oid, own) => {
    const stopped = () => own() || input.halt?.stopped === true;
    if (stopped()) return;
    if (budget) {
      // Wait for in-flight reads to return their unused reservation before
      // judging that the budget cannot cover another member.
      while (budget.remaining < MAX_CALLS_PER_MEMBER) {
        if (stopped()) return;
        if (waiting.inFlight === 0) throw new MemberSumOverBudget();
        await new Promise<void>((resolve) => waiting.wake.push(resolve));
      }
      if (stopped()) return;
      budget.remaining -= MAX_CALLS_PER_MEMBER;
      waiting.inFlight += 1;
    }
    let used = 0;
    try {
      const who = await resolve(oid, canLookUp, stopped);
      resolved.set(oid, who);
      used = who.lookedUp ? 1 : 0;
      if (!who.litellmUserId || stopped()) return;
      const result = await getUserDailySpend({
        litellmUserId: who.litellmUserId,
        startDate: input.startDate,
        endDate: input.endDate,
      });
      const page = result.metadata.page;
      used += typeof page === "number" && page > 1 ? page : 1;
      let spend = 0;
      for (const row of reduceDaily(result.results)) {
        spend += row.spend;
        byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.spend);
      }
      spendByOid.set(oid, spend);
    } finally {
      if (budget) {
        budget.remaining += MAX_CALLS_PER_MEMBER - used;
        waiting.inFlight -= 1;
        for (const wake of waiting.wake.splice(0)) wake();
      }
    }
  });

  const daily = [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, spend]) => ({ date, spend }));
  const members: Member[] = oids.map((oid) => {
    const who = resolved.get(oid);
    const matched = spendByOid.has(oid);
    return {
      oid,
      ...(who?.name ? { name: who.name } : {}),
      matched,
      ...(matched && !input.perUserCostHidden
        ? { spend: spendByOid.get(oid) ?? 0 }
        : {}),
    };
  });
  const matched = members.filter((m) => m.matched).length;
  return {
    total: daily.reduce((sum, d) => sum + d.spend, 0),
    daily,
    coverage: {
      members: members.length,
      matched,
      unmatched: members.length - matched,
      pending,
    },
    members,
  };
}
