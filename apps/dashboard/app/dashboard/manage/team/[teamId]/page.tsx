import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { SectionBoundary } from "@/components/display/SectionBoundary";
import { AccessSections } from "@/components/settings/access/AccessSections";
import { accessCapabilities } from "@/components/settings/access/capabilities";
import { TeamPageContent } from "@/components/manage/TeamPageContent";
import { TeamSummarySection } from "@/components/manage/TeamSummarySection";
import { globalRolesOf, resolveScope } from "@/lib/auth/policy";
import { resolveUrlRange } from "@/lib/date-range";
import { INTERNAL_ADMIN_ROLE } from "@/lib/auth/roles";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { isMatrixWriter } from "@/lib/auth/write-policy";
import { authorizationFor } from "@/lib/litellm/route-guard";
import { managementAccessFor } from "@/lib/manage-access";
import { findTeamInScope } from "@/lib/manage/team-scope";
import { scopeLabelFor } from "@/lib/scope-labels";
import { isSectionVisible, type AccessSectionSlug } from "@/lib/settings-tabs";

import {
  stepUpWithCredentials,
  stepUpWithDevLogin,
  stepUpWithEntra,
} from "../../../settings/step-up-actions";

// The team-level access surface of a lead now that Settings is closed to it
// (Design System - Management pages, Team; slice B2, B2-4).
const ACCESS_SECTIONS: readonly AccessSectionSlug[] = [
  "members",
  "team-admins",
  "pending-access",
  "visibility",
];

// Server-side gate (Access Control - Enforcement item 2, TM1 sentence): an
// unknown team and a team outside the caller's scope are the same not-found
// page. Each write route still enforces its own rights.
export default async function TeamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams?: Promise<{ dateFrom?: string; dateTo?: string }>;
}) {
  const { teamId } = await params;
  const { dateFrom, dateTo } = (await searchParams) ?? {};
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

  const entry = await findTeamInScope(teamId, access.global, scope);
  if (!entry) notFound();

  const canEdit = isMatrixWriter(roles);

  const viewer = await loadSettingsAccessViewer(session);
  const capabilities = viewer ? accessCapabilities(viewer) : null;
  const hasAccessSections =
    viewer !== undefined &&
    capabilities !== null &&
    ACCESS_SECTIONS.some((slug) => isSectionVisible(slug, capabilities));

  return (
    <TeamPageContent
      teamId={teamId}
      canRaiseLimits={roles.includes(INTERNAL_ADMIN_ROLE)}
      scopeLabel={access.global ? null : scopeLabelFor(scope)}
      summary={
        <SectionBoundary title="summary">
          <TeamSummarySection
            entry={entry}
            global={access.global}
            range={resolveUrlRange(dateFrom, dateTo)}
            canEdit={canEdit}
          />
        </SectionBoundary>
      }
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
            teamId={teamId}
            departmentId={entry.departmentId}
          />
        ) : undefined
      }
    />
  );
}
