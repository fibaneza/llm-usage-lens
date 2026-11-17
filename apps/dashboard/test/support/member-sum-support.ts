import { vi } from "vitest";

import { createPendingItem } from "@/lib/data/access/pending";
import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import type { FakeCall, FakeHandler } from "@/test/fakes/fake-litellm";
import { viewsHandler } from "@/test/fakes/fake-litellm-views";
import type { Suite } from "@/test/fakes/fake-litellm-views";
import { ctxAt } from "@/test/support/access-test-support";
import { seedIdentity } from "@/test/support/matrix-route-support";
import { loadFixtures, makeAccount, putRaw } from "@/test/support/test-support";

// Test-only harness for the L4b member-sum suites (not imported by production
// code). Rule 60.22: DynamoDB Local for the affiliations, identities and
// links; the in-process fake LiteLLM for the per-user reads (Rule 60.24).
// Source: docs/specs/2026-11-17-app-teams.md - "Member sum" steps 1-7.

export type SeedMember = {
  oid: string;
  // An identity record (verified email, display name) is written when given.
  email?: string;
  name?: string;
  // The stored IdentityLink.litellmUserId, when the member has one.
  litellmUserId?: string;
};

const SEED_AT = "2026-11-01T00:00:00.000Z";

// A bound affiliation of `teamId` (the GSI1 item listAllTeamMemberOids reads),
// plus the identity and link items when asked for. Raw puts keep a 200-member
// team cheap to seed; the shapes match what addMember / putIdentityLink write.
export async function seedBoundMember(
  teamId: string,
  m: SeedMember,
): Promise<void> {
  await putRaw({
    PK: `IDENT#${m.oid}`,
    SK: "AFFILIATION",
    gsi1pk: `MEMBERS#TEAM#${teamId}`,
    gsi1sk: `IDENT#${m.oid}`,
    oid: m.oid,
    teamId,
    source: "ui",
    version: 1,
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
    createdBy: "seed",
  });
  if (m.email) await seedIdentity(m.oid, { email: m.email, name: m.name });
  if (m.litellmUserId) {
    await putRaw({
      PK: `IDENT#${m.oid}`,
      SK: "LINK",
      oid: m.oid,
      usageIdentities: [],
      aliases: [],
      litellmUserId: m.litellmUserId,
      version: 1,
      updatedAt: SEED_AT,
    });
  }
}

export async function seedPendingMember(teamId: string, emailOrUpn: string) {
  const result = await createPendingItem(
    { kind: "affiliation", emailOrUpn, teamId },
    ctxAt(undefined, `req-pending-${emailOrUpn}`),
  );
  if (!result.ok) throw new Error(`pending seed failed: ${result.code}`);
}

// `count` members of `teamId`, every one with a stored LiteLLM user id
// (`lu-<prefix>-<n>`), so reading them needs no email lookup.
export async function seedLinkedMembers(
  teamId: string,
  count: number,
  prefix = teamId,
): Promise<string[]> {
  const ids: string[] = [];
  for (let n = 1; n <= count; n += 1) {
    const luser = `lu-${prefix}-${n}`;
    ids.push(luser);
    await seedBoundMember(teamId, {
      oid: `oid-${prefix}-${n}`,
      litellmUserId: luser,
    });
  }
  return ids;
}

// An unlinked app team (no TeamLink) in dept-eng, readable by deptAdminEng.
export async function seedUnlinkedTeam(teamId: string, accountNo: number) {
  await loadFixtures({
    accounts: [
      makeAccount(accountNo, {
        teamId,
        teamName: teamId.toUpperCase(),
        departmentId: "dept-eng",
        departmentName: "Engineering",
      }),
    ],
  });
}

// ---- the scenario every member-sum suite reads --------------------------------
//
// team-u (unlinked, dept-eng) holds three bound members and one pending:
//   u1  stored link "luser-u1"                    -> matched, 1.5 + 2    = 3.5
//   u2  no link; findUserByEmail -> "uid-u2"      -> matched, 0.5        = 0.5
//   u3  no link; not in LiteLLM                   -> unmatched ("not in LiteLLM")
//   p1  pending affiliation (never bound)         -> counted, not summed
// Total 4.0; by UTC day 2026-11-02 = 2.0, 2026-11-03 = 2.0.
export const SCENARIO = {
  teamId: "team-u",
  u1: { oid: "oid-u1", email: "u1@company.com", name: "Una One" },
  u2: { oid: "oid-u2", email: "u2@company.com", name: "Dos Two" },
  u3: { oid: "oid-u3", email: "u3@company.com", name: "Tres Three" },
  pendingEmail: "p1@company.com",
  luserU1: "luser-u1",
  luserU2: "uid-u2",
  total: 4,
  daily: [
    { date: "2026-11-02", spend: 2 },
    { date: "2026-11-03", spend: 2 },
  ],
  coverage: { members: 3, matched: 2, unmatched: 1, pending: 1 },
} as const;

export async function seedScenario(): Promise<void> {
  const s = SCENARIO;
  await seedBoundMember(s.teamId, { ...s.u1, litellmUserId: s.luserU1 });
  await seedBoundMember(s.teamId, s.u2);
  await seedBoundMember(s.teamId, s.u3);
  await seedPendingMember(s.teamId, s.pendingEmail);
}

export type DailyRow = { date: string; spend: number };

export type MemberSumFakeOptions = {
  // GET /user/daily/activity rows by LiteLLM user id (default: no rows).
  daily?: Record<string, DailyRow[]>;
  // Users whose daily read answers 404 (a failing member read; no retry).
  failUsers?: string[];
  // GET /user/list?user_email=<email>: the users LiteLLM answers with, by
  // lower-cased email. `null` is "no such user". Unlisted emails fall through
  // to the views fake.
  emailLookup?: Record<string, { user_id: string; user_email: string } | null>;
  // GET /team/daily/activity/aggregated: spend over the range by LiteLLM team
  // id (L4b round 1, LD36). The answer sums the ids in `team_ids` (an id not
  // listed is 0) as one row on 2026-11-02, so a per-team read gets that team's
  // range spend and an all-teams read gets the sum. Differs on purpose from the
  // views fake's `team_info.spend` (12.5) so a budget-period figure is caught.
  teamDaily?: Record<string, number>;
  // Pages of GET /user/daily/activity for a user with no entry in `daily`
  // (LiteLLM spec - Combined usage, LT34: page_size 1000 and metadata.has_more):
  // page n of N answers one row on 2026-11-0<n> of spend 1, has_more until N.
  // So one such user spends N and costs N LiteLLM calls (LD34, L6 review Q3).
  pagedDaily?: number;
};

export const TEAM_DAILY_SPEND = {
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": 2,
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": 3,
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc": 0.5,
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd": 0.25,
  "99999999-9999-4999-8999-999999999999": 1,
} as const;
export const TEAM_DAILY_TOTAL = 6.75;

export const SCENARIO_FAKE: MemberSumFakeOptions = {
  daily: {
    [SCENARIO.luserU1]: [
      { date: "2026-11-02", spend: 1.5 },
      { date: "2026-11-03", spend: 2 },
    ],
    [SCENARIO.luserU2]: [{ date: "2026-11-02", spend: 0.5 }],
  },
  emailLookup: {
    [SCENARIO.u2.email]: {
      user_id: SCENARIO.luserU2,
      user_email: SCENARIO.u2.email,
    },
    [SCENARIO.u3.email]: null,
  },
};

export function memberSumHandler(opts: MemberSumFakeOptions = {}): FakeHandler {
  const base = viewsHandler();
  return (call: FakeCall, attempt: number) => {
    const q = new URL(call.url).searchParams;
    const route = `${call.method} ${call.path}`;
    if (route === "GET /user/daily/activity") {
      const userId = q.get("user_id") ?? "";
      if (opts.failUsers?.includes(userId)) {
        return { status: 404, body: { detail: "user not found" } };
      }
      const pages = opts.pagedDaily;
      if (pages !== undefined && !(opts.daily && userId in opts.daily)) {
        const page = Number(q.get("page") ?? "1");
        return {
          status: 200,
          body: {
            results:
              page <= pages
                ? [
                    {
                      date: `2026-11-0${page}`,
                      metrics: { spend: 1, total_tokens: 15 },
                    },
                  ]
                : [],
            metadata: { page, has_more: page < pages },
          },
        };
      }
      const rows = opts.daily?.[userId] ?? [];
      return {
        status: 200,
        body: {
          results: rows.map((r) => ({
            date: r.date,
            metrics: {
              spend: r.spend,
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
              api_requests: 1,
              successful_requests: 1,
              failed_requests: 0,
            },
          })),
          metadata: {},
        },
      };
    }
    if (route === "GET /team/daily/activity/aggregated" && opts.teamDaily) {
      const ids = (q.get("team_ids") ?? "").split(",").filter(Boolean);
      const spend = ids.reduce(
        (sum, id) => sum + (opts.teamDaily?.[id] ?? 0),
        0,
      );
      return {
        status: 200,
        body: {
          results: [
            {
              date: "2026-11-02",
              metrics: {
                spend,
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
                api_requests: 1,
                successful_requests: 1,
                failed_requests: 0,
              },
            },
          ],
          metadata: {},
        },
      };
    }
    const email = q.get("user_email")?.toLowerCase();
    if (route === "GET /user/list" && email && opts.emailLookup) {
      if (email in opts.emailLookup) {
        const found = opts.emailLookup[email];
        return { status: 200, body: { users: found ? [found] : [] } };
      }
    }
    return base(call, attempt);
  };
}

export type FetchTracker = { inflight: number; max: number };

// Replaces the suite's fake with the member-sum fake. Every call yields once
// before it is answered, so overlapping reads are visible in `max` (the cap on
// concurrent LiteLLM reads, AT6).
export function installMemberSumFake(
  state: Suite,
  opts: MemberSumFakeOptions = {},
): FetchTracker {
  state.fake = createFakeLiteLLM(memberSumHandler(opts));
  const tracker: FetchTracker = { inflight: 0, max: 0 };
  const inner = state.fake.fetch;
  vi.stubGlobal("fetch", (async (...args: Parameters<typeof fetch>) => {
    tracker.inflight += 1;
    tracker.max = Math.max(tracker.max, tracker.inflight);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return await inner(...args);
    } finally {
      tracker.inflight -= 1;
    }
  }) as typeof fetch);
  return tracker;
}

export const userDailyCalls = (state: Suite) =>
  state.fake.calls.filter((c) => c.path === "/user/daily/activity");

export const userIdsRead = (state: Suite) =>
  userDailyCalls(state)
    .map((c) => new URL(c.url).searchParams.get("user_id") ?? "")
    .sort();
