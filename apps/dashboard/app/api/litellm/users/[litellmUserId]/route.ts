import {
  DateRangeQuerySchema,
  LiteLLMUserDetailResponseSchema,
  canonicalUsageIdentity,
} from "@llm-usage-lens/shared";

import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import {
  NOT_FOUND_MESSAGE,
  NotFoundError,
  jsonData,
  parseInput,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { buildTeamDirectory } from "@/lib/api/team-directory";
import { getAffiliation } from "@/lib/data/access/affiliations";
import { listAppTeams } from "@/lib/data/access/app-teams";
import {
  getIdentityLink,
  getLiteLLMUserOwner,
  getUsageKeysClaimedWith,
} from "@/lib/data/access/identity-links";
import { personNamesOf } from "@/lib/data/access/identities";
import { getAllAccounts } from "@/lib/data/account-meta";
import { listTeamLinks } from "@/lib/data/litellm/team-links";
import { LiteLLMError } from "@/lib/litellm/client";
import { combinedVisibility, computePerson } from "@/lib/litellm/combined";
import { loadGateway, reduceCombinedRows } from "@/lib/litellm/combined-data";
import { getUser, getUserDailySpend } from "@/lib/litellm/operations";
import {
  LiteLLMUserIdSchema,
  enabledOperations,
  liteLLMResponse,
  reduceDaily,
  requireEnabled,
  teamAccess,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "API routes"
// (/api/litellm/users/[litellmUserId] GET: Lead for a member of a team in
// scope, org-admin, Admin, Auditor; otherwise 404), "Views by role (L3b)"
// (Users tab; out of scope is the same 404 as missing), "Reads" (timezone=0,
// LD20), LT21, Access Control - Enforcement item 2. No keys and no LiteLLM
// team ids leave the route. L6 (Combined usage -> Routes, Person): adds the
// person's `combined` figure from the same daily read, omitted while the
// Organisation cap hides per-user cost (LD23, LT31).

export const dynamic = "force-dynamic";

const notFound = () => new NotFoundError(NOT_FOUND_MESSAGE);

type AppTeamRef = { teamId: string; name: string };

// LP2 (Design System - LiteLLM user page, T-LP7; LiteLLM spec - API routes,
// LD23): link data for the three global roles, read per request (Rule 60.10).
// Links are not cost, so the Organisation cap does not hide them.
async function linkData(
  litellmUserId: string,
  teams: ReadonlyArray<Record<string, unknown>>,
) {
  const [links, accounts, appTeams, owner] = await Promise.all([
    listTeamLinks(),
    getAllAccounts(),
    listAppTeams(),
    getLiteLLMUserOwner(litellmUserId),
  ]);
  const directory = new Map(
    buildTeamDirectory(accounts, appTeams).map((t) => [t.teamId, t]),
  );
  const refOf = (teamId: string): AppTeamRef | null => {
    const team = directory.get(teamId);
    return team ? { teamId, name: team.teamName } : null;
  };
  const appTeamOfLiteLLM = new Map(
    links.map((l) => [l.litellmTeamId, refOf(l.teamId)]),
  );
  const teamRows = teams.flatMap((t) =>
    typeof t.team_id === "string"
      ? [
          {
            litellmTeamId: t.team_id,
            alias: typeof t.team_alias === "string" ? t.team_alias : null,
            appTeam: appTeamOfLiteLLM.get(t.team_id) ?? null,
          },
        ]
      : [],
  );
  let appUser = null;
  if (owner) {
    const [names, affiliation, link] = await Promise.all([
      personNamesOf([owner]),
      getAffiliation(owner),
      getIdentityLink(owner),
    ]);
    const person = names.get(owner);
    // No identity item yet: the link's own canonical email stands in.
    const email =
      person?.email ?? link?.usageIdentities.find((k) => k.includes("@")) ?? "";
    appUser = {
      oid: owner,
      name: person?.displayName ?? (email || owner),
      email,
      appTeam: affiliation ? refOf(affiliation.teamId) : null,
    };
  }
  return { teams: teamRows, appUser };
}

export const GET = withRoute(async (request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const access = await teamAccess(session);
  if (!access.orgWide && !access.lead) throw notFound();
  const litellmUserId = parseInput(
    (await params).litellmUserId,
    LiteLLMUserIdSchema,
  );
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  return liteLLMResponse(async () => {
    const enabled = await enabledOperations();
    requireEnabled(
      enabled,
      access.perUserCostHidden ? ["getUser"] : ["getUser", "getUserDailySpend"],
    );
    const info = await getUser({ litellmUserId }).catch((error: unknown) => {
      if (error instanceof LiteLLMError && error.status === 404) {
        throw notFound();
      }
      throw error;
    });
    if (!access.orgWide) {
      const inScope = new Set(access.linked.map((t) => t.litellmTeamId));
      const member = info.teams.some(
        (t) => typeof t.team_id === "string" && inScope.has(t.team_id),
      );
      if (!member) throw notFound();
    }
    // Organisation cap: identity only, no cost read at all (LD23, T16).
    if (access.perUserCostHidden) {
      return jsonData(
        LiteLLMUserDetailResponseSchema.parse({
          userId: litellmUserId,
          email: info.user_info?.user_email ?? litellmUserId,
          enabledOperations: enabled,
          ...(access.orgWide ? await linkData(litellmUserId, info.teams) : {}),
        }),
      );
    }
    const daily = await getUserDailySpend({
      litellmUserId,
      startDate: dateFrom,
      endDate: dateTo,
    });
    // Combined is for global readers only (LT32): decided before any gateway,
    // usage-key or rollup read, and the key is absent for everyone else.
    let combined: unknown;
    if (access.orgWide) {
      const gateway = await loadGateway();
      const visibility = combinedVisibility(true, gateway.configured);
      const email = info.user_info?.user_email;
      const usageKeys = new Set(
        email
          ? await getUsageKeysClaimedWith(canonicalUsageIdentity(email).key)
          : [],
      );
      combined = {
        visibility,
        configured: true,
        gatewayConfigured: gateway.configured,
        ...computePerson({
          rollups: await loadRangeRollups(dateFrom, dateTo),
          gateway,
          usageKeys,
          litellm: {
            kind: "rows",
            rows: reduceCombinedRows(daily.results),
          },
        }),
      };
    }
    return jsonData(
      LiteLLMUserDetailResponseSchema.parse({
        userId: litellmUserId,
        email: info.user_info?.user_email ?? litellmUserId,
        ...(combined === undefined ? {} : { combined }),
        // Absent spend is null, shown as a dash; never an invented $0 (LF1).
        spend: info.user_info?.spend ?? null,
        maxBudget: info.user_info?.max_budget ?? null,
        daily: reduceDaily(daily.results),
        enabledOperations: enabled,
        ...(access.orgWide ? await linkData(litellmUserId, info.teams) : {}),
      }),
    );
  });
});
