import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { UserDetailContent } from "@/components/manage/users/detail/UserDetailContent";
import { accessCapabilities } from "@/components/settings/access/capabilities";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { parsePageIdParam } from "@/lib/api/id-param";
import { managementAccessFor } from "@/lib/manage-access";
import { withLiteLLMSuggestion } from "@/lib/manage/litellm-email-suggestion";
import { loadIdentityDetail } from "@/lib/manage/user-detail";

import {
  stepUpWithCredentials,
  stepUpWithDevLogin,
  stepUpWithEntra,
} from "../../../settings/step-up-actions";

// Design System - "The user page (unit US2)": global readers only; anyone else
// and an unknown oid are the same missing-page 404 (Access Control - T-US1).
// The detail is built per request by the builder the route shares.
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ oid: string }>;
}) {
  const oid = parsePageIdParam((await params).oid);
  if (!oid) notFound();
  const session = await auth();
  const access = await managementAccessFor(session);
  if (!access.users || !session) notFound();
  const loaded = await loadIdentityDetail(session, oid);
  if (!loaded) notFound();
  const detail = await withLiteLLMSuggestion(loaded);
  const viewer = await loadSettingsAccessViewer(session);
  if (!viewer) notFound();
  return (
    <UserDetailContent
      detail={detail}
      canOpenPasswordUsers={accessCapabilities(viewer).passwordUsers !== "none"}
      canOpenLiteLLM={access.litellm}
      authMethod={viewer.authMethod}
      stepUp={{
        entra: stepUpWithEntra,
        credentials: stepUpWithCredentials,
        devLogin: stepUpWithDevLogin,
      }}
    />
  );
}
