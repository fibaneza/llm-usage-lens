import { auth } from "@/auth";
import {
  LiteLLMContent,
  type LiteLLMTabId,
} from "@/components/litellm/LiteLLMContent";
import { globalRolesOf, resolveScope } from "@/lib/auth/policy";
import type { Scope } from "@/lib/auth/policy";
import {
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
} from "@/lib/auth/roles";
import { authorizationFor } from "@/lib/litellm/route-guard";

// The tab set per role (LiteLLM spec -- Views by role): Admin and Auditor see
// every tab, an org-admin all but Audit, a Lead (any team or department admin
// scope) My usage, Team and Users, everyone else My usage. Roles are resolved
// on the server (Rule 10.3, 50.3); the routes enforce them again.
const isLead = (scope: Scope) =>
  scope.teamScopes.size > 0 || scope.departmentScopes.size > 0;

export default async function LiteLLMPage() {
  const session = await auth();
  const input = await authorizationFor(session);
  const roles = globalRolesOf(session, input.appEnv, input.roleGrants) ?? [];

  // Live scopes, as the routes resolve them: a suspended SSO scope (groups
  // overage) grants nothing, a manual one never suspends (Access Control -
  // Enforcement).
  const scope = resolveScope({
    ...input,
    session,
    adminScopes: input.adminScopes ?? [],
  });

  let tabs: LiteLLMTabId[] = ["my-usage"];
  if (
    roles.includes(INTERNAL_ADMIN_ROLE) ||
    roles.includes(INTERNAL_AUDITOR_ROLE)
  ) {
    tabs = ["my-usage", "team", "organisation", "users", "audit"];
  } else if (roles.includes(INTERNAL_ORG_ADMIN_ROLE)) {
    tabs = ["my-usage", "team", "organisation", "users"];
  } else if (isLead(scope)) {
    tabs = ["my-usage", "team", "users"];
  }
  return <LiteLLMContent tabs={tabs} />;
}
