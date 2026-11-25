import {
  DateRangeQuerySchema,
  LiteLLMOrgResponseSchema,
} from "@llm-usage-lens/shared";

import {
  jsonData,
  jsonError,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { buildTeamDirectory } from "@/lib/api/team-directory";
import { getAllAccounts } from "@/lib/data/account-meta";
import { listAppTeams } from "@/lib/data/access/app-teams";
import { listAllTeamMemberOids } from "@/lib/data/access/team-member-lookup";
import { listTeamLinks } from "@/lib/data/litellm/team-links";
import {
  MAX_MEMBERS,
  MemberSumOverBudget,
  computeMemberSum,
  worstCaseCalls,
} from "@/lib/litellm/member-sum";
import { isLiteLLMConfigured } from "@/lib/litellm/client";
import {
  getTeam,
  getTeamDailySpend,
  listProxyTeams,
} from "@/lib/litellm/operations";
import {
  enabledOperations,
  liteLLMResponse,
  reduceDaily,
  requireEnabled,
  teamAccess,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";
import { runBoundedSettled } from "@/lib/litellm/run-settled";

// Source: docs/specs/2026-11-17-app-teams.md — "Organisation view" (two
// tables; the total comes from the LiteLLM teams, AT5; 200 member reads per
// request, smallest unlinked team first, AT6; any failed read fails the
// request, AT7), "Allowlist changes" (listProxyTeams for org-admin and
// Auditor); docs/specs/2026-11-10-litellm.md — "API routes"
// (/api/litellm/org GET: org-admin, Admin, Auditor), "Reads" (timezone=0,
// LD20), LD19, Rule 10.3 (403 before input parsing).

export const dynamic = "force-dynamic";

const READ_CONCURRENCY = 5;
const MEMBER_READ_BUDGET = 200;

export const GET = withRoute(async (request, _ctx, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const access = await teamAccess(session);
  if (!access.orgWide) {
    return jsonError(403, "FORBIDDEN", "Insufficient permission");
  }
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  const range = { startDate: dateFrom, endDate: dateTo };
  return liteLLMResponse(async () => {
    const [enabled, accounts, links] = await Promise.all([
      enabledOperations(),
      Promise.all([getAllAccounts(), listAppTeams()]).then(([a, t]) =>
        buildTeamDirectory(a, t),
      ),
      listTeamLinks(),
    ]);
    const linkOf = new Map(links.map((l) => [l.teamId, l.litellmTeamId]));
    const appTeams = new Map<string, string>();
    for (const a of accounts) {
      if (!appTeams.has(a.teamId)) appTeams.set(a.teamId, a.teamName);
    }
    const unlinked = [...appTeams.keys()].filter((id) => !linkOf.has(id));
    requireEnabled(enabled, [
      "listProxyTeams",
      "getTeam",
      "getTeamDailySpend",
      ...(unlinked.length > 0 ? (["getUserDailySpend"] as const) : []),
    ]);
    // LD37 (after LD19): not configured is an empty LiteLLM view, not a failure; the app
    // teams stay listed with no spend and LiteLLM is never called.
    if (!(await isLiteLLMConfigured())) {
      return jsonData(
        LiteLLMOrgResponseSchema.parse({
          configured: false,
          totals: { spend: 0, requests: 0, tokens: 0, failedRequests: 0 },
          daily: [],
          dailyByTeam: [],
          litellmTeams: [],
          appTeams: [...appTeams]
            .sort(([, a], [, b]) => a.localeCompare(b))
            .map(([teamId, teamName]) => ({
              teamId,
              teamName,
              spendSource: linkOf.has(teamId)
                ? ("litellm-team" as const)
                : ("member-sum" as const),
              spend: null,
            })),
          enabledOperations: enabled,
        }),
      );
    }

    // LD34/LD36: the 200-call budget counts every LiteLLM call of the request.
    // The list, a getTeam and a one-team range read per proxy team come first.
    const proxyTeams = await listProxyTeams();
    const proxyIds = proxyTeams.map((t) => t.team_id);
    const infos = new Map<string, Awaited<ReturnType<typeof getTeam>>>();
    const rangeOf = new Map<string, ReturnType<typeof reduceDaily>>();
    const reads: Array<() => Promise<void>> = proxyIds.flatMap(
      (litellmTeamId) => [
        async () => {
          infos.set(litellmTeamId, await getTeam({ litellmTeamId }));
        },
        async () => {
          const daily = await getTeamDailySpend({ litellmTeamId, ...range });
          rangeOf.set(litellmTeamId, reduceDaily(daily.results));
        },
      ],
    );
    await runBoundedSettled(reads, READ_CONCURRENCY, (read) => read());
    const byDate = new Map<
      string,
      { spend: number; requests: number; tokens: number }
    >();
    const rangeSpend = new Map<string, number>();
    let failedRequests = 0;
    for (const [litellmTeamId, days] of rangeOf) {
      let spend = 0;
      for (const d of days) {
        spend += d.spend;
        failedRequests += d.failedRequests;
        const day = byDate.get(d.date) ?? { spend: 0, requests: 0, tokens: 0 };
        day.spend += d.spend;
        day.requests += d.apiRequests;
        day.tokens += d.totalTokens;
        byDate.set(d.date, day);
      }
      rangeSpend.set(litellmTeamId, spend);
    }
    const rows = [...byDate]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, day]) => ({ date, ...day }));
    const dailyByTeam = proxyTeams.map((t) => ({
      litellmTeamId: t.team_id,
      alias: t.team_alias ?? null,
      daily: (rangeOf.get(t.team_id) ?? [])
        .map((d) => ({
          date: d.date,
          spend: d.spend,
          requests: d.apiRequests,
          tokens: d.totalTokens,
        }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    }));

    const appOfLiteLLM = new Map(
      links.map((l) => [
        l.litellmTeamId,
        { teamId: l.teamId, teamName: appTeams.get(l.teamId) ?? l.teamId },
      ]),
    );
    const litellmTeams = proxyTeams.map((t) => {
      const info = infos.get(t.team_id);
      return {
        litellmTeamId: t.team_id,
        alias: t.team_alias ?? null,
        spend: rangeSpend.get(t.team_id) ?? 0,
        maxBudget: info?.team_info.max_budget ?? null,
        memberCount: info?.team_memberships.length ?? 0,
        linkedAppTeam: appOfLiteLLM.get(t.team_id) ?? null,
      };
    });
    const spendOfLiteLLM = new Map(
      litellmTeams.map((t) => [t.litellmTeamId, t.spend]),
    );

    // Unlinked teams, smallest first. Membership is read once per team and the
    // same list sizes the team and feeds the sum (LD34). A team's worst case is
    // reserved before it is summed; the fixed reads above are never skipped, so
    // past the budget every unlinked team is an open-team row.
    const budget = {
      remaining: Math.max(0, MEMBER_READ_BUDGET - (1 + reads.length)),
    };
    const sized = await Promise.all(
      unlinked.map(async (teamId) => {
        const oids = await listAllTeamMemberOids(teamId);
        return { teamId, oids };
      }),
    );
    sized.sort(
      (a, b) =>
        a.oids.length - b.oids.length ||
        (appTeams.get(a.teamId) ?? "").localeCompare(
          appTeams.get(b.teamId) ?? "",
        ),
    );
    const sums = new Map<
      string,
      Awaited<ReturnType<typeof computeMemberSum>> | null
    >();
    for (const { teamId, oids } of sized) {
      if (oids.length > MAX_MEMBERS) {
        sums.set(teamId, null);
        continue;
      }
      const worstCase = await worstCaseCalls(oids);
      if (worstCase > budget.remaining) {
        sums.set(teamId, null);
        continue;
      }
      try {
        sums.set(
          teamId,
          await computeMemberSum({
            teamId,
            memberOids: oids,
            ...range,
            perUserCostHidden: access.perUserCostHidden,
            budget,
          }),
        );
      } catch (error) {
        // Pages counted in flight; no partial sum (LD34).
        if (!(error instanceof MemberSumOverBudget)) throw error;
        sums.set(teamId, null);
      }
    }

    const appRows = [...appTeams]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([teamId, teamName]) => {
        const litellmTeamId = linkOf.get(teamId);
        if (litellmTeamId !== undefined) {
          return {
            teamId,
            teamName,
            spendSource: "litellm-team" as const,
            spend: spendOfLiteLLM.get(litellmTeamId) ?? null,
          };
        }
        const sum = sums.get(teamId);
        return sum
          ? {
              teamId,
              teamName,
              spendSource: "member-sum" as const,
              spend: sum.total,
              coverage: sum.coverage,
            }
          : {
              teamId,
              teamName,
              spendSource: "member-sum" as const,
              spend: null,
              reason: "open-team" as const,
            };
      });

    return jsonData(
      LiteLLMOrgResponseSchema.parse({
        configured: true,
        totals: {
          spend: rows.reduce((sum, r) => sum + r.spend, 0),
          requests: rows.reduce((sum, r) => sum + r.requests, 0),
          tokens: rows.reduce((sum, r) => sum + r.tokens, 0),
          failedRequests,
        },
        daily: rows,
        dailyByTeam,
        litellmTeams,
        appTeams: appRows,
        enabledOperations: enabled,
      }),
    );
  });
});
