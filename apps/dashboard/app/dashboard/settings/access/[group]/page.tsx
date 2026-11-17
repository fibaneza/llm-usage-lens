import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { AccessSections } from "@/components/settings/access/AccessSections";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { managementAccessFor } from "@/lib/manage-access";
import { settingsTabsFor } from "@/lib/settings-tabs";

import {
  stepUpWithCredentials,
  stepUpWithDevLogin,
  stepUpWithEntra,
} from "../../step-up-actions";

// The sub-tab is the route segment (Design System "Settings Page" - Access
// sub-tabs); an unknown or unusable one is the same 404. The viewer is resolved
// per request and passed down (Rule 10.3, 50.3, 60.10).
export default async function AccessGroupPage({
  params,
}: {
  params: Promise<{ group: string }>;
}) {
  const { group } = await params;
  const session = await auth();
  if (!(await managementAccessFor(session)).settings) notFound();
  const viewer = await loadSettingsAccessViewer(session);
  const subTab = settingsTabsFor(viewer)
    .find((t) => t.id === "access")
    ?.subTabs.find((s) => s.id === group);
  if (!viewer || !subTab) notFound();
  return (
    <AccessSections
      viewer={viewer}
      stepUp={{
        entra: stepUpWithEntra,
        credentials: stepUpWithCredentials,
        devLogin: stepUpWithDevLogin,
      }}
      sections={subTab.sections}
    />
  );
}
