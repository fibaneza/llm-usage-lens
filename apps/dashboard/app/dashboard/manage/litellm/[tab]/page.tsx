import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { auth } from "@/auth";
import { LiteLLMSection } from "@/components/litellm/LiteLLMSection";
import { OrganisationSection } from "@/components/litellm/OrganisationSection";
import { LiteLLMTeamLinksSection } from "@/components/settings/litellm-panel/LiteLLMTeamLinksSection";
import { LiteLLMUsersSection } from "@/components/settings/litellm-panel/LiteLLMUsersSection";
import { INTERNAL_ADMIN_ROLE } from "@/lib/auth/roles";
import { litellmPanelCapabilities } from "@/lib/auth/litellm-panel";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { managementAccessFor } from "@/lib/manage-access";

import { LITELLM_AREA_TABS } from "../litellm-area-tabs";

// Design System - Management pages, LiteLLM area (D2, D3, D4). The tab is the
// route segment; an unknown one is the missing-page 404. Authorized per
// request (Rule 60.10). Edit flags follow LD24: team links Admin and
// org-admin, LiteLLM team creation Admin only, auditor read-only.
export default async function LiteLLMAreaTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  const session = await auth();
  if (!(await managementAccessFor(session)).litellm) notFound();
  const def = LITELLM_AREA_TABS.find((t) => t.id === tab);
  if (!def) notFound();

  let body: ReactNode;
  switch (def.id) {
    case "organisation":
      body = (
        <LiteLLMSection title="Organisation" reported>
          <OrganisationSection />
        </LiteLLMSection>
      );
      break;
    case "teams": {
      const viewer = await loadSettingsAccessViewer(session);
      if (!viewer) notFound();
      const capabilities = litellmPanelCapabilities(viewer.roles);
      body = (
        <LiteLLMSection title="LiteLLM teams">
          <LiteLLMTeamLinksSection
            canEdit={capabilities.editTeamLinks}
            canCreateTeam={viewer.roles.includes(INTERNAL_ADMIN_ROLE)}
          />
        </LiteLLMSection>
      );
      break;
    }
    case "users":
      body = (
        <LiteLLMSection title="LiteLLM users">
          <LiteLLMUsersSection />
        </LiteLLMSection>
      );
      break;
  }
  return body;
}
