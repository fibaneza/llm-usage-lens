import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { LiteLLMTab } from "@/components/settings/LiteLLMTab";
import { litellmPanelCapabilities } from "@/lib/auth/litellm-panel";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";

// Authorized per request, in the page itself (Rule 60.10); an unusable tab is
// the same 404 as a missing page. The panel's per-section edit flags for the
// org-admin are LiteLLM unit L3d2.
export default async function LiteLLMSettingsPage() {
  const session = await auth();
  const viewer = await loadSettingsAccessViewer(session);
  if (!viewer) notFound();
  const capabilities = litellmPanelCapabilities(viewer.roles);
  if (!capabilities.visible) notFound();
  return <LiteLLMTab capabilities={capabilities} />;
}
