import { jsonData, withRoute } from "@/lib/api/respond";
import { getAllAccounts } from "@/lib/data/account-meta";
import { listTeamLinks } from "@/lib/data/litellm/team-links";
import { LiteLLMError, isLiteLLMConfigured } from "@/lib/litellm/client";
import { LiteLLMOperationRefused } from "@/lib/litellm/gateway";
import { listProxyTeams } from "@/lib/litellm/operations";
import { enabledOperations } from "@/lib/litellm/read-views";
import { litellmReadRefusal, openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes"
// (/api/litellm/team-links GET Admin + Auditor) and "Data model additions"
// (TeamLink, listed from GSI1); docs/specs/2026-11-17-app-teams.md — "API
// changes" build details (additive `appTeams` for the Spend source column);
// docs/specs/2026-11-10-litellm.md — "API routes" (M1: additive optional
// `litellmTeams` from listProxyTeams for the D4a pickers, MI-D4a, LD37, LT-MI3).

export const dynamic = "force-dynamic";

type LiteLLMTeamsRead =
  | { configured: false }
  | {
      configured: true;
      litellmTeams: { litellmTeamId: string; alias: string }[];
    }
  | { configured: true; litellmTeamsUnavailable: true };

// The picker list is a convenience: a toggle that is off or an outage marks it
// unavailable and never fails the links list. The toggle is checked before
// LiteLLM is configured or called; not configured is empty, never 503 (LD37).
async function readLiteLLMTeams(): Promise<LiteLLMTeamsRead> {
  if (!(await enabledOperations()).includes("listProxyTeams")) {
    return { configured: true, litellmTeamsUnavailable: true };
  }
  if (!(await isLiteLLMConfigured())) return { configured: false };
  try {
    const teams = await listProxyTeams();
    return {
      configured: true,
      litellmTeams: teams
        .map((t) => ({
          litellmTeamId: t.team_id,
          alias: t.team_alias ?? t.team_id,
        }))
        .sort((a, b) => a.alias.localeCompare(b.alias)),
    };
  } catch (error) {
    if (
      error instanceof LiteLLMError ||
      error instanceof LiteLLMOperationRefused
    ) {
      return { configured: true, litellmTeamsUnavailable: true };
    }
    throw error;
  }
}

export const GET = withRoute(async (_request, _ctx, session) => {
  const refused = openModeRefusal() ?? (await litellmReadRefusal(session));
  if (refused) return refused;
  const [items, accounts, litellm] = await Promise.all([
    listTeamLinks(),
    getAllAccounts(),
    readLiteLLMTeams(),
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
  return jsonData({ items, appTeams, ...litellm });
});
