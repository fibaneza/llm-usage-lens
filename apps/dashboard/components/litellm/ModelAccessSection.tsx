"use client";

import { Badge } from "@/components/ui/badge";

import { Empty, NotConnected, Unavailable } from "./LiteLLMSection";
import { useTeamDetail } from "./use-team-detail";

// Read-only in L3: the team's allowed models from the proxy list.
export function ModelAccessSection({ teamId }: { teamId: string }) {
  const result = useTeamDetail(teamId);
  if (result.status === "unavailable") return <Unavailable />;
  const data = result.data;
  if (!data.connected) return <NotConnected />;
  const { team } = data;
  if (team.models.length === 0) {
    return <Empty>No model restrictions are set for this team.</Empty>;
  }
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Models this team can use">
      {team.models.map((model) => (
        <li key={model}>
          <Badge variant="outline">{model}</Badge>
        </li>
      ))}
    </ul>
  );
}
