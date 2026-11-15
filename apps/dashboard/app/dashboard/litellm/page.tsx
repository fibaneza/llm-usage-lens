import { auth } from "@/auth";
import {
  LiteLLMContent,
  type LiteLLMTabId,
} from "@/components/litellm/LiteLLMContent";
import {
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
} from "@/lib/auth/roles";
import { authorizationFor } from "@/lib/litellm/route-guard";
import { globalRolesOf } from "@/lib/auth/policy";

// The tab set per role (LiteLLM spec -- Views by role): Admin and Auditor see
// every tab, an org-admin all but Audit, a Lead (any team or department admin
// scope) My usage, Team and Users, everyone else My usage. Roles are resolved
// on the server (Rule 10.3, 50.3); the routes enforce them again.
export default async function LiteLLMPage() {
  const session = await auth();
  const input = await authorizationFor(session);
  const roles = globalRolesOf(session, input.appEnv, input.roleGrants) ?? [];

  let tabs: LiteLLMTabId[] = ["my-usage"];
  if (
    roles.includes(INTERNAL_ADMIN_ROLE) ||
    roles.includes(INTERNAL_AUDITOR_ROLE)
  ) {
    tabs = ["my-usage", "team", "organisation", "users", "audit"];
  } else if (roles.includes(INTERNAL_ORG_ADMIN_ROLE)) {
    tabs = ["my-usage", "team", "organisation", "users"];
  } else if ((input.adminScopes?.length ?? 0) > 0) {
    tabs = ["my-usage", "team", "users"];
  }
  return <LiteLLMContent tabs={tabs} />;
}
