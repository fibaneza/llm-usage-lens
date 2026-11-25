"use client";

import Link from "next/link";

import { Unavailable } from "@/components/litellm/LiteLLMSection";
import { Panel } from "@/components/display/Panel";

import { useProxyUser } from "./use-proxy-user";

// Design System - LiteLLM user page (unit LP2), T-LP8: each LiteLLM team links
// to its page (LP1). A Lead's answer has no `teams`: nothing is listed.
function TeamsBody({ litellmUserId }: { litellmUserId: string }) {
  const result = useProxyUser(litellmUserId);
  if (result.status !== "ok") return <Unavailable />;
  const teams = result.data.teams;
  if (teams === undefined) return null;
  if (teams.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Not in any LiteLLM team</p>
    );
  }
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {teams.map((team) => (
        <li key={team.litellmTeamId}>
          <Link
            href={`/dashboard/manage/litellm/teams/${encodeURIComponent(team.litellmTeamId)}`}
            className="focus-visible:ring-ring rounded-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {team.alias ?? team.litellmTeamId}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ProxyUserTeamsPanel({
  litellmUserId,
}: {
  litellmUserId: string;
}) {
  return (
    <Panel title="LiteLLM teams" boundaryTitle="LiteLLM teams">
      <TeamsBody litellmUserId={litellmUserId} />
    </Panel>
  );
}
