"use client";

import { AccessReviewSection } from "@/components/settings/access/AccessReviewSection";
import { AccessSection } from "@/components/settings/access/AccessSection";
import { AuditLogSection } from "@/components/settings/access/AuditLogSection";
import { accessCapabilities } from "@/components/settings/access/capabilities";
import { GroupMappingsSection } from "@/components/settings/access/GroupMappingsSection";
import { IdentityLinksSection } from "@/components/settings/access/IdentityLinksSection";
import { MembersSection } from "@/components/settings/access/MembersSection";
import { PendingAccessSection } from "@/components/settings/access/PendingAccessSection";
import { PasswordUsersSection } from "@/components/settings/access/PasswordUsersSection";
import { PerUserApprovalSection } from "@/components/settings/access/PerUserApprovalSection";
import { RoleGrantsSection } from "@/components/settings/access/RoleGrantsSection";
import { TeamAdminsSection } from "@/components/settings/access/TeamAdminsSection";
import { VisibilitySection } from "@/components/settings/access/VisibilitySection";
import { IdentityLinkSuggestions } from "@/components/settings/IdentityLinkSuggestions";
import { IdentityMapRulesEditor } from "@/components/settings/IdentityMapRulesEditor";
import type {
  AccessViewer,
  StepUpActions,
} from "@/components/settings/access/types";
import { isSectionVisible, type AccessSectionSlug } from "@/lib/settings-tabs";

// Source: docs/specs/2026-11-10-access-control.md - "Permission matrix";
// design-system "Settings Page" (Access: a section the caller cannot use is
// not rendered, and fetches nothing). Each section has its own boundary
// (Rule 40.4, 60.12); the write routes enforce the matrix again (Rule 10.3).
export function AccessSections({
  viewer,
  stepUp,
  sections,
}: {
  viewer: AccessViewer;
  stepUp: StepUpActions;
  // Unit D: the Access sub-tab or Audit tab narrows what renders; the
  // capabilities still gate each section.
  sections?: readonly AccessSectionSlug[];
}) {
  const capabilities = accessCapabilities(viewer);
  const visible = (slug: AccessSectionSlug) =>
    (sections === undefined || sections.includes(slug)) &&
    isSectionVisible(slug, capabilities);
  const canEditLinks = capabilities.identityLinks === "edit";

  return (
    <>
      {visible("members") ? (
        <AccessSection
          slug="members"
          heading="Members"
          title="the members"
          description="Each person belongs to at most one team."
        >
          <MembersSection viewer={viewer} />
        </AccessSection>
      ) : null}
      {visible("team-admins") ? (
        <AccessSection
          slug="team-admins"
          heading="Team admins"
          title="the team admins"
          description="Admins of a team or department manage its members and visibility."
        >
          <TeamAdminsSection viewer={viewer} />
        </AccessSection>
      ) : null}
      {visible("visibility") ? (
        <AccessSection
          slug="visibility"
          heading="Visibility"
          title="the visibility settings"
          description="What each team and department shows to its users."
        >
          <VisibilitySection viewer={viewer} />
        </AccessSection>
      ) : null}
      {visible("pending-access") ? (
        <AccessSection
          slug="pending-access"
          heading="Pending and stale access"
          title="the pending and stale access"
          description="Invitations not yet bound to a sign-in, and access whose person has not signed in lately."
        >
          <PendingAccessSection />
        </AccessSection>
      ) : null}
      {visible("group-mappings") ? (
        <AccessSection
          slug="group-mappings"
          heading="Group mappings"
          title="the group mappings"
          description="Entra groups that grant a team or department role at sign-in."
        >
          <GroupMappingsSection
            canEdit={capabilities.groupMappings === "edit"}
          />
        </AccessSection>
      ) : null}
      {visible("role-grants") ? (
        <AccessSection
          slug="role-grants"
          heading="Role grants"
          title="the role grants"
          description="Global roles granted in the app, each with a reason."
        >
          <RoleGrantsSection
            canEdit={capabilities.roleGrants === "edit"}
            authMethod={viewer.authMethod}
            stepUp={stepUp}
          />
        </AccessSection>
      ) : null}
      {visible("identity-links") ? (
        <AccessSection
          slug="identity-links"
          heading="Identity links"
          title="the identity links"
          description="Usage keys and aliases that show a person their own usage."
        >
          <IdentityLinksSection canEdit={canEditLinks} />
        </AccessSection>
      ) : null}
      {visible("identity-mapping") ? (
        <AccessSection
          slug="identity-mapping"
          heading="Identity mapping"
          title="the identity mapping"
        >
          <div className="flex flex-col gap-6">
            <IdentityMapRulesEditor isAdmin={canEditLinks} />
            <IdentityLinkSuggestions isAdmin={canEditLinks} />
          </div>
        </AccessSection>
      ) : null}
      {visible("password-users") ? (
        <AccessSection
          slug="password-users"
          heading="Password users"
          title="the password users"
          description="Users who sign in with a password and an authenticator."
        >
          <PasswordUsersSection
            canEdit={capabilities.passwordUsers === "edit"}
            authMethod={viewer.authMethod}
            stepUp={stepUp}
          />
        </AccessSection>
      ) : null}
      {visible("per-user-approval") ? (
        <AccessSection
          slug="per-user-approval"
          heading="Per-user approval"
          title="the per-user approval"
        >
          <PerUserApprovalSection
            canEdit={capabilities.perUserApproval === "edit"}
          />
        </AccessSection>
      ) : null}
      {visible("audit-log") ? (
        <AccessSection
          slug="audit-log"
          heading="Audit log"
          title="the audit log"
          description="Security and change records for one UTC day."
        >
          <AuditLogSection />
        </AccessSection>
      ) : null}
      {visible("access-review") ? (
        <AccessSection
          slug="access-review"
          heading="Access review"
          title="the access review"
        >
          <AccessReviewSection />
        </AccessSection>
      ) : null}
    </>
  );
}
