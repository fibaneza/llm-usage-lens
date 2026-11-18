import { accessCapabilities } from "@/components/settings/access/capabilities";
import { INTERNAL_ADMIN_ROLE, INTERNAL_ORG_ADMIN_ROLE } from "@/lib/auth/roles";

// Source: docs/specs/2026-11-10-access-control.md - "Permission matrix" and
// "LiteLLM user links"; Design System - Management improvements, Users (D15).
// Which Add user steps a caller may do, computed on the server from the
// effective global roles and handed to the UI as plain flags (Rule 10.3, 50.3).
// The write routes enforce each permission again.
export type AddUserSteps = {
  // Step 1: a password user, pre-SSO only (no Entra) and internal-admin only.
  password: boolean;
  // Step 2: a pending team member by email (the Members matrix).
  team: boolean;
  // Step 3 and the row link controls: admin and org-admin (D16).
  link: boolean;
};

export function addUserStepsFor(input: {
  roles: readonly string[];
  entra: boolean;
}): AddUserSteps {
  const capabilities = accessCapabilities({
    roles: input.roles,
    adminScopes: [],
  });
  return {
    password: !input.entra && capabilities.passwordUsers === "edit",
    team: capabilities.members,
    link:
      input.roles.includes(INTERNAL_ADMIN_ROLE) ||
      input.roles.includes(INTERNAL_ORG_ADMIN_ROLE),
  };
}
