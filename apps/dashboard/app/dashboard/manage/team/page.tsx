import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { globalRolesOf, resolveScope } from "@/lib/auth/policy";
import { isMatrixWriter } from "@/lib/auth/write-policy";
import { TeamListTable } from "@/components/manage/TeamListTable";
import { authorizationFor } from "@/lib/litellm/route-guard";
import { managementAccessFor } from "@/lib/manage-access";
import { listTeamRows, type TeamListRow } from "@/lib/manage/team-list";
import { findTeamInScope, teamInScope } from "@/lib/manage/team-scope";
import { scopeLabelFor } from "@/lib/scope-labels";

// Server-side gate (LiteLLM spec - Team configuration page, LD25; Access
// Control - Navigation and landing by role, Enforcement item 2): a global
// reader (admin, org admin, read-only auditor) or a live lead gets the list;
// everyone else gets the standard not-found page. The list holds only teams in
// scope; a non-empty `?team=<id>` redirects to the team page, out of scope is the same 404
// (unit TM1 agent decision).
export default async function TeamListPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; view?: string }>;
}) {
  const { team, view } = await searchParams;
  const session = await auth();
  const access = await managementAccessFor(session);
  if (!access.team) notFound();

  const input = await authorizationFor(session);
  const roles = globalRolesOf(session, input.appEnv, input.roleGrants) ?? [];
  const scope = resolveScope({
    ...input,
    session,
    adminScopes: input.adminScopes ?? [],
  });

  if (team) {
    if (!access.global && !(await findTeamInScope(team, false, scope))) {
      notFound();
    }
    const suffix = view ? `?view=${encodeURIComponent(view)}` : "";
    redirect(`/dashboard/manage/team/${encodeURIComponent(team)}${suffix}`);
  }

  const allowed = (t: { teamId: string; departmentId: string }) =>
    teamInScope(scope, access.global, t);
  const rows: TeamListRow[] = (await listTeamRows(allowed))
    .filter(allowed)
    .map((r) => ({
      ...r,
      litellmTeamId: access.global ? r.litellmTeamId : null,
      litellmLinked: r.litellmTeamId !== null,
    }));

  return (
    <TeamListTable
      rows={rows}
      canCreateTeam={isMatrixWriter(roles)}
      scopeLabel={access.global ? null : scopeLabelFor(scope)}
    />
  );
}
