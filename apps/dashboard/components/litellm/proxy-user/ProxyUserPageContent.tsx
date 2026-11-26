"use client";

import { ClientOnly } from "@/components/litellm/ClientOnly";
import { PageHeader } from "@/components/layout/PageHeader";

import { ProxyUserDailyPanel } from "./ProxyUserDailyPanel";
import { ProxyUserLinkPanel } from "./ProxyUserLinkPanel";
import { ProxyUserSummaryPanel } from "./ProxyUserSummaryPanel";
import { ProxyUserTeamsPanel } from "./ProxyUserTeamsPanel";

// Design System - LiteLLM user page (unit LP2), T-LP8, Rule 40.9: the page h1
// stays in the top bar; every section is a Panel with its own boundary.
export function ProxyUserPageContent({
  litellmUserId,
  canWrite,
  ownOid,
}: {
  litellmUserId: string;
  canWrite: boolean;
  ownOid: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={[
          { label: "LiteLLM users", href: "/dashboard/manage/litellm/users" },
          { label: litellmUserId },
        ]}
      />
      <ClientOnly>
        <ProxyUserSummaryPanel litellmUserId={litellmUserId} />
        <ProxyUserDailyPanel litellmUserId={litellmUserId} />
        <ProxyUserTeamsPanel litellmUserId={litellmUserId} />
        <ProxyUserLinkPanel
          litellmUserId={litellmUserId}
          canWrite={canWrite}
          ownOid={ownOid}
        />
      </ClientOnly>
    </div>
  );
}
