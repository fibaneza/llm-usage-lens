"use client";

import { Panel } from "@/components/display/Panel";

import { useProxyTeam } from "./use-proxy-team";

// Design System - LiteLLM team page (unit LP1), T-LP4: the linked app team
// with its lead names, or "Not linked to a dashboard team".
function LinkBody({ litellmTeamId }: { litellmTeamId: string }) {
  const result = useProxyTeam(litellmTeamId);
  if (result.status !== "ok") {
    return (
      <p className="text-muted-foreground text-sm">
        LiteLLM is unavailable right now.
      </p>
    );
  }
  const linked = result.data.linkedAppTeam;
  if (!linked) {
    return (
      <p className="text-muted-foreground text-sm">
        Not linked to a dashboard team
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{linked.name}</span>
      {linked.leads.length > 0 ? (
        <ul className="text-muted-foreground">
          {linked.leads.map((lead) => (
            <li key={lead.name}>{lead.name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ProxyTeamLinkPanel({
  litellmTeamId,
}: {
  litellmTeamId: string;
}) {
  return (
    <Panel title="Linked dashboard team" boundaryTitle="Linked dashboard team">
      <LinkBody litellmTeamId={litellmTeamId} />
    </Panel>
  );
}
