import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { AccessSections } from "@/components/settings/access/AccessSections";
import { accessCapabilities } from "@/components/settings/access/capabilities";
import { TeamPageContent } from "@/components/manage/TeamPageContent";
import { globalRolesOf, resolveScope } from "@/lib/auth/policy";
import { INTERNAL_ADMIN_ROLE } from "@/lib/auth/roles";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { getAllAccounts } from "@/lib/data/account-meta";
import { authorizationFor } from "@/lib/litellm/route-guard";
import { managementAccessFor } from "@/lib/manage-access";
import { scopeLabelFor } from "@/lib/scope-labels";
import { isSectionVisible, type AccessSectionSlug } from "@/lib/settings-tabs";

import {
  stepUpWithCredentials,
  stepUpWithDevLogin,
  stepUpWithEntra,
} from "../../settings/step-up-actions";

// The team-level access surface of a lead now that Settings is closed to it
// (Design System - Management pages, Team; slice B2, B2-4).
const ACCESS_SECTIONS: readonly AccessSectionSlug[] = [
  "members",
  "team-admins",
  "pending-access",
  "visibility",
];

// Server-side gate (LiteLLM spec - Team configuration page, LD25; Access
// Control - Navigation and landing by role): a global reader (admin, org admin,
// read-only auditor) or a live lead gets the page; everyone else, and a team
// outside a lead's scope, get the standard not-found page. Each write route
// still enforces its own rights.
export default async function TeamManagePage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const { team } = await searchParams;
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

  if (!access.global && team !== undefined) {
    let inScope = scope.teamScopes.has(team);
    if (!inScope && scope.departmentScopes.size > 0) {
      const meta = (await getAllAccounts()).find((a) => a.teamId === team);
      inScope = !!meta && scope.departmentScopes.has(meta.departmentId);
    }
    if (!inScope) notFound();
  }

  const viewer = await loadSettingsAccessViewer(session);
  const capabilities = viewer ? accessCapabilities(viewer) : null;
  const hasAccessSections =
    viewer !== undefined &&
    capabilities !== null &&
    ACCESS_SECTIONS.some((slug) => isSectionVisible(slug, capabilities));

  return (
    <TeamPageContent
      canRaiseLimits={roles.includes(INTERNAL_ADMIN_ROLE)}
      scopeLabel={access.global ? null : scopeLabelFor(scope)}
      access={
        hasAccessSections ? (
          <AccessSections
            viewer={viewer}
            stepUp={{
              entra: stepUpWithEntra,
              credentials: stepUpWithCredentials,
              devLogin: stepUpWithDevLogin,
            }}
            sections={ACCESS_SECTIONS}
          />
        ) : undefined
      }
    />
  );
}
