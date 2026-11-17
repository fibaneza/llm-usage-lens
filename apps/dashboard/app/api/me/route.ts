import { trace } from "@opentelemetry/api";

import { MeResponseSchema } from "@llm-usage-lens/shared";

import { cursorSecret } from "@/lib/api/access-route";
import { ownUsageKeys } from "@/lib/api/me";
import { jsonData, withRoute } from "@/lib/api/respond";
import { scopeFor } from "@/lib/api/scoped-rollups";
import { leadEmailOfTeam } from "@/lib/data/access/team-lead";

// Authorization data is read per request, never cached (Rule 60.10). The
// member team's visibility needs a second read because the team is only known
// once the affiliation has resolved.
export const GET = withRoute(async (_request, _ctx, session) => {
  const first = await scopeFor(session, []);
  const memberTeamId = first.memberTeamId;
  const scope =
    memberTeamId === null
      ? first
      : await scopeFor(session, [], { teamIds: [memberTeamId] });
  const email = session.user.email ?? null;
  const memberTeamVisible =
    memberTeamId !== null &&
    (scope.visibility.teams.get(memberTeamId)?.teamLevel ?? "visible") ===
      "visible";
  let leadEmail: string | null = null;
  if (memberTeamId !== null) {
    try {
      leadEmail = await leadEmailOfTeam(memberTeamId, cursorSecret());
    } catch (error) {
      trace
        .getActiveSpan()
        ?.recordException(
          error instanceof Error ? error : new Error("lead lookup failed"),
        );
    }
  }
  return jsonData(
    MeResponseSchema.parse({
      oid: session.user.oid,
      email,
      roles: session.user.roles ?? [],
      usageIdentities: [...ownUsageKeys(scope, email)].sort(),
      global: scope.global,
      memberTeamId,
      memberTeamVisible,
      teamScopes: [...scope.teamScopes].sort(),
      departmentScopes: [...scope.departmentScopes].sort(),
      leadEmail,
    }),
  );
});
