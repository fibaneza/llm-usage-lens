import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { AuditPageContent } from "@/components/manage/AuditPageContent";
import { AccessSections } from "@/components/settings/access/AccessSections";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { managementAccessFor } from "@/lib/manage-access";

import {
  stepUpWithCredentials,
  stepUpWithDevLogin,
  stepUpWithEntra,
} from "../../settings/step-up-actions";

// Design System - Management pages, Audit: the App source (dashboard audit log
// and Access review) and the Gateway source (LiteLLM's audit), each offered
// only when the caller may read it; neither readable is the 404 (slice B2,
// B2-1, B2-8; Access Control - Audit for org admin).
export default async function AuditManagePage() {
  const session = await auth();
  const access = await managementAccessFor(session);
  if (!access.audit.app && !access.audit.gateway) notFound();

  const viewer = access.audit.app
    ? await loadSettingsAccessViewer(session)
    : undefined;
  const sources = [
    ...(access.audit.app ? (["app"] as const) : []),
    ...(access.audit.gateway ? (["gateway"] as const) : []),
  ];

  return (
    <AuditPageContent
      sources={sources}
      app={
        viewer ? (
          <AccessSections
            viewer={viewer}
            stepUp={{
              entra: stepUpWithEntra,
              credentials: stepUpWithCredentials,
              devLogin: stepUpWithDevLogin,
            }}
            sections={["audit-log", "access-review"]}
          />
        ) : undefined
      }
    />
  );
}
