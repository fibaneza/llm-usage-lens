import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { TeamConfigContent } from "@/components/litellm/TeamConfigContent";
import { globalRolesOf, resolveScope } from "@/lib/auth/policy";
import { INTERNAL_ADMIN_ROLE, INTERNAL_ORG_ADMIN_ROLE } from "@/lib/auth/roles";
import { getAllAccounts } from "@/lib/data/account-meta";
import { authorizationFor } from "@/lib/litellm/route-guard";

// Server-side gate only (LiteLLM spec -- Team configuration page, LD25): Admin,
// org-admin or a live Lead (a suspended SSO scope grants nothing) get the page;
// everyone else, and a team outside the caller's scope, get the standard
// not-found page (404 parity). Each write route still enforces its own rights.
export default async function TeamConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const { team } = await searchParams;
  const session = await auth();
  const input = await authorizationFor(session);
  const roles = globalRolesOf(session, input.appEnv, input.roleGrants) ?? [];
  const scope = resolveScope({
    ...input,
    session,
    adminScopes: input.adminScopes ?? [],
  });

  const global =
    roles.includes(INTERNAL_ADMIN_ROLE) ||
    roles.includes(INTERNAL_ORG_ADMIN_ROLE);
  const lead = scope.teamScopes.size > 0 || scope.departmentScopes.size > 0;
  if (!global && !lead) notFound();

  if (!global && team !== undefined) {
    let inScope = scope.teamScopes.has(team);
    if (!inScope && scope.departmentScopes.size > 0) {
      const meta = (await getAllAccounts()).find((a) => a.teamId === team);
      inScope = !!meta && scope.departmentScopes.has(meta.departmentId);
    }
    if (!inScope) notFound();
  }
  return (
    <TeamConfigContent canRaiseLimits={roles.includes(INTERNAL_ADMIN_ROLE)} />
  );
}
