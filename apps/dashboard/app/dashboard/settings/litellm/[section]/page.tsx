import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { auth } from "@/auth";
import { LiteLLMConnectionSection } from "@/components/settings/litellm-panel/LiteLLMConnectionSection";
import { LiteLLMGatewaySection } from "@/components/settings/litellm-panel/LiteLLMGatewaySection";
import { LiteLLMGuardrailsSection } from "@/components/settings/litellm-panel/LiteLLMGuardrailsSection";
import { LiteLLMTeamLinksSection } from "@/components/settings/litellm-panel/LiteLLMTeamLinksSection";
import { LiteLLMUsersSection } from "@/components/settings/litellm-panel/LiteLLMUsersSection";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { litellmPanelCapabilities } from "@/lib/auth/litellm-panel";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { managementAccessFor } from "@/lib/manage-access";
import { settingsTabsFor } from "@/lib/settings-tabs";

// The sub-tab is the route segment (Design System "Settings Page" - LiteLLM
// sub-tabs); an unknown or unusable one is the same 404. Authorized per
// request (Rule 60.10); edit flags per LiteLLM spec LD24.
export default async function LiteLLMSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const session = await auth();
  if (!(await managementAccessFor(session)).settings) notFound();
  const viewer = await loadSettingsAccessViewer(session);
  if (!viewer) notFound();
  const capabilities = litellmPanelCapabilities(viewer.roles);
  if (!capabilities.visible) notFound();
  const subTab = settingsTabsFor(viewer)
    .find((t) => t.id === "litellm")
    ?.subTabs.find((s) => s.id === section);
  if (!subTab) notFound();

  let body: ReactNode;
  switch (subTab.id) {
    case "connection":
      body = <LiteLLMConnectionSection canEdit={capabilities.editConnection} />;
      break;
    case "guardrails":
      body = <LiteLLMGuardrailsSection canEdit={capabilities.editGuardrails} />;
      break;
    case "team-links":
      body = <LiteLLMTeamLinksSection canEdit={capabilities.editTeamLinks} />;
      break;
    case "users":
      body = <LiteLLMUsersSection />;
      break;
    case "gateway":
      body = <LiteLLMGatewaySection canEdit={capabilities.editConnection} />;
      break;
    default:
      notFound();
  }
  return (
    <SettingsSection heading="LiteLLM" title={subTab.label}>
      {body}
    </SettingsSection>
  );
}
