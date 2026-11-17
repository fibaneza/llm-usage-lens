import { jsonData, withRoute } from "@/lib/api/respond";
import { getAllAccounts } from "@/lib/data/account-meta";
import { listTeamLinks } from "@/lib/data/litellm/team-links";
import { litellmReadRefusal, openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes"
// (/api/litellm/team-links GET Admin + Auditor) and "Data model additions"
// (TeamLink, listed from GSI1); docs/specs/2026-11-17-app-teams.md — "API
// changes" build details (additive `appTeams` for the Spend source column).

export const dynamic = "force-dynamic";

export const GET = withRoute(async (_request, _ctx, session) => {
  const refused = openModeRefusal() ?? (await litellmReadRefusal(session));
  if (refused) return refused;
  const [items, accounts] = await Promise.all([
    listTeamLinks(),
    getAllAccounts(),
  ]);
  const linked = new Set(items.map((l) => l.teamId));
  const names = new Map(accounts.map((a) => [a.teamId, a.teamName]));
  const appTeams = [...names]
    .map(([teamId, teamName]) => ({
      teamId,
      teamName,
      spendSource: linked.has(teamId)
        ? ("litellm-team" as const)
        : ("member-sum" as const),
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
  return jsonData({ items, appTeams });
});
