import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { ProxyTeamPageContent } from "@/components/litellm/proxy-team/ProxyTeamPageContent";
import { ProxyUserPageContent } from "@/components/litellm/proxy-user/ProxyUserPageContent";
import { parsePageIdParam } from "@/lib/api/id-param";
import { litellmPanelCapabilities } from "@/lib/auth/litellm-panel";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { PathLiteLLMId } from "@/lib/litellm/litellm-id-write";
import { proxyTeamExists } from "@/lib/litellm/proxy-team-exists";
import { proxyUserExists } from "@/lib/litellm/proxy-user-exists";
import { managementAccessFor } from "@/lib/manage-access";

// Design System - LiteLLM team page (unit LP1, T-LP4) and user page (unit LP2,
// T-LP8): the teams and users tabs have a detail page, for the three
// LiteLLM-reading global roles; anyone else, a bad id and an unknown id get
// the missing page. Authorized per request
// (Rule 60.10); Reset controls follow the teams tab's edit flag (RS2).
export default async function LiteLLMDetailPage({
  params,
}: {
  params: Promise<{ tab: string; id: string }>;
}) {
  const { tab, id } = await params;
  const session = await auth();
  if (!(await managementAccessFor(session)).litellm) notFound();
  if (tab !== "teams" && tab !== "users") notFound();
  const decoded = parsePageIdParam(id);
  const litellmId = PathLiteLLMId.safeParse(decoded);
  if (decoded === null || !litellmId.success) notFound();
  const viewer = await loadSettingsAccessViewer(session);
  if (!viewer) notFound();
  const canWrite = litellmPanelCapabilities(viewer.roles).editTeamLinks;
  if (tab === "users") {
    if (!(await proxyUserExists(litellmId.data))) notFound();
    return (
      <ProxyUserPageContent
        litellmUserId={litellmId.data}
        canWrite={canWrite}
        ownOid={session?.user?.oid ?? null}
      />
    );
  }
  if (!(await proxyTeamExists(litellmId.data))) notFound();
  return (
    <ProxyTeamPageContent litellmTeamId={litellmId.data} canReset={canWrite} />
  );
}
