import { jsonData, withRoute } from "@/lib/api/respond";
import { buildTeamDirectory } from "@/lib/api/team-directory";
import { getAllAccounts } from "@/lib/data/account-meta";
import { listAppTeams } from "@/lib/data/access/app-teams";
import { listTeamLinks } from "@/lib/data/litellm/team-links";
import { mapTeamMembers } from "@/lib/data/litellm/team-members";
import { getTeam } from "@/lib/litellm/operations";
import {
  enabledOperations,
  liteLLMResponse,
  requireEnabled,
} from "@/lib/litellm/read-views";
import {
  adminOrAuditorRefusal,
  openModeRefusal,
} from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "Identity mapping and members"
// (Settings lists LiteLLM members who are no longer dashboard members),
// "API routes" (/api/litellm/orphans GET Admin, Auditor), "Reads" (getTeam),
// LD23 (identities only, no spend or limits; not subject to the Organisation
// cap).

export const dynamic = "force-dynamic";

type OrphanRow = {
  teamId: string;
  teamName: string;
  litellmUserId: string;
  email: string;
  name?: string;
};

export const GET = withRoute(async (_request, _ctx, session) => {
  const refused = openModeRefusal() ?? (await adminOrAuditorRefusal(session));
  if (refused) return refused;
  return liteLLMResponse(async () => {
    requireEnabled(await enabledOperations(), ["getTeam"]);
    const [accounts, links] = await Promise.all([
      Promise.all([getAllAccounts(), listAppTeams()]).then(([a, t]) =>
        buildTeamDirectory(a, t),
      ),
      listTeamLinks(),
    ]);
    const names = new Map<string, string>();
    for (const a of accounts)
      if (!names.has(a.teamId)) names.set(a.teamId, a.teamName);

    const perTeam = await Promise.all(
      links.map(async (link): Promise<OrphanRow[]> => {
        const [info, dashboardMembers] = await Promise.all([
          getTeam({ litellmTeamId: link.litellmTeamId }),
          mapTeamMembers(link.teamId),
        ]);
        const teamName = names.get(link.teamId) ?? link.teamId;
        return (info.team_info.members_with_roles ?? []).flatMap((m) => {
          if (!m.user_id) return [];
          const email = m.user_email ?? m.user_id;
          const known =
            dashboardMembers.has(m.user_id.toLowerCase()) ||
            dashboardMembers.has(email.toLowerCase());
          return known
            ? []
            : [
                {
                  teamId: link.teamId,
                  teamName,
                  litellmUserId: m.user_id,
                  email,
                },
              ];
        });
      }),
    );
    const items = perTeam
      .flat()
      .sort(
        (x, y) =>
          x.teamName.localeCompare(y.teamName) ||
          x.email.localeCompare(y.email),
      );
    return jsonData({ items });
  });
});
