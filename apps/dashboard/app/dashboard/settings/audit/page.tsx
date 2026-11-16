import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { AccessSections } from "@/components/settings/access/AccessSections";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { settingsTabsFor } from "@/lib/settings-tabs";

import {
  stepUpWithCredentials,
  stepUpWithDevLogin,
  stepUpWithEntra,
} from "../step-up-actions";

export default async function AuditPage() {
  const session = await auth();
  const viewer = await loadSettingsAccessViewer(session);
  const audit = settingsTabsFor(viewer).find((t) => t.id === "audit");
  if (!viewer || !audit) notFound();
  return (
    <AccessSections
      viewer={viewer}
      stepUp={{
        entra: stepUpWithEntra,
        credentials: stepUpWithCredentials,
        devLogin: stepUpWithDevLogin,
      }}
      sections={audit.sections}
    />
  );
}
