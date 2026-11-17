import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { managementAccessFor } from "@/lib/manage-access";
import { settingsTabsFor } from "@/lib/settings-tabs";

// Lands on the caller's first visible LiteLLM sub-tab (Design System "Settings
// Page" - LiteLLM sub-tabs). Authorized per request (Rule 60.10); an unusable
// tab is the same 404 as a missing page.
export default async function LiteLLMSettingsIndexPage() {
  const session = await auth();
  if (!(await managementAccessFor(session)).settings) notFound();
  const viewer = await loadSettingsAccessViewer(session);
  if (!viewer) notFound();
  const first = settingsTabsFor(viewer).find((t) => t.id === "litellm")
    ?.subTabs[0];
  if (!first) notFound();
  redirect(first.href);
}
