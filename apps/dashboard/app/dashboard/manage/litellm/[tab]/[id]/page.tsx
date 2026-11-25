import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { ProxyTeamPageContent } from "@/components/litellm/proxy-team/ProxyTeamPageContent";
import { parsePageIdParam } from "@/lib/api/id-param";
import { litellmPanelCapabilities } from "@/lib/auth/litellm-panel";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { PathLiteLLMId } from "@/lib/litellm/litellm-id-write";
import { proxyTeamExists } from "@/lib/litellm/proxy-team-exists";
import { managementAccessFor } from "@/lib/manage-access";

// Design System - LiteLLM team page (unit LP1), T-LP4: only the teams tab has
// a detail page, for the three LiteLLM-reading global roles; anyone else, a
// bad id and an unknown team get the missing page. Authorized per request
// (Rule 60.10); Reset controls follow the teams tab's edit flag (RS2).
export default async function LiteLLMTeamPage({
  params,
}: {
  params: Promise<{ tab: string; id: string }>;
}) {
  const { tab, id } = await params;
  const session = await auth();
  if (!(await managementAccessFor(session)).litellm) notFound();
  if (tab !== "teams") notFound();
  const decoded = parsePageIdParam(id);
  const litellmTeamId = PathLiteLLMId.safeParse(decoded);
  if (decoded === null || !litellmTeamId.success) notFound();
  const viewer = await loadSettingsAccessViewer(session);
  if (!viewer) notFound();
  if (!(await proxyTeamExists(litellmTeamId.data))) notFound();
  return (
    <ProxyTeamPageContent
      litellmTeamId={litellmTeamId.data}
      canReset={litellmPanelCapabilities(viewer.roles).editTeamLinks}
    />
  );
}
