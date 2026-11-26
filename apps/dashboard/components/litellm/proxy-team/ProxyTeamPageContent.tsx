"use client";

import { Panel } from "@/components/display/Panel";
import { ClientOnly } from "@/components/litellm/ClientOnly";
import { PageHeader } from "@/components/layout/PageHeader";
import { LiteLLMTeamMembersPanel } from "@/components/settings/litellm-panel/LiteLLMTeamMembersPanel";

import { ProxyTeamDailyPanel } from "./ProxyTeamDailyPanel";
import { ProxyTeamLinkPanel } from "./ProxyTeamLinkPanel";
import { ProxyTeamSummaryPanel } from "./ProxyTeamSummaryPanel";
import { useProxyTeamState } from "./use-proxy-team";

// Design System - LiteLLM team page (unit LP1), T-LP4, T-LP5, Rule 40.9: the
// page h1 stays in the top bar; every section is a Panel.
function MembersBody({
  litellmTeamId,
  canReset,
}: {
  litellmTeamId: string;
  canReset: boolean;
}) {
  const result = useProxyTeamState(litellmTeamId).data;
  const alias =
    result?.status === "ok"
      ? (result.data.alias ?? litellmTeamId)
      : litellmTeamId;
  return (
    <LiteLLMTeamMembersPanel
      litellmTeamId={litellmTeamId}
      teamName={alias}
      canReset={canReset}
    />
  );
}

export function ProxyTeamPageContent({
  litellmTeamId,
  name,
  canReset,
}: {
  litellmTeamId: string;
  name?: string | null;
  canReset: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={[
          { label: "LiteLLM teams", href: "/dashboard/manage/litellm/teams" },
          { label: name ?? litellmTeamId },
        ]}
      />
      <ClientOnly>
        <ProxyTeamSummaryPanel litellmTeamId={litellmTeamId} />
        <ProxyTeamDailyPanel litellmTeamId={litellmTeamId} />
        <Panel title="Members" boundaryTitle="Members">
          <MembersBody litellmTeamId={litellmTeamId} canReset={canReset} />
        </Panel>
        <ProxyTeamLinkPanel litellmTeamId={litellmTeamId} />
      </ClientOnly>
    </div>
  );
}
