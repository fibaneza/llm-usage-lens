import { TeamLinkSchema } from "@llm-usage-lens/shared";
import type { TeamLink } from "@llm-usage-lens/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { mutateApi } from "@/lib/query/fetch-api";

import { TEAM_LINKS_KEY } from "./keys";
import { TeamLinkPicker } from "./TeamLinkPicker";

export type LiteLLMTeamList =
  | { state: "ready"; teams: { litellmTeamId: string; alias: string }[] }
  | { state: "not-configured" }
  | { state: "unavailable" };

// Source: docs/specs/2026-11-10-litellm.md -- API routes (PUT
// /api/litellm/team-links/{teamId}, versioned: null creates); Design System --
// Management improvements, D4a (2026-11-17): both ids come from searchable
// lists, linked ones are not selectable, and an unreadable LiteLLM list says so
// with no free-text fallback.
export type AppTeamChoices =
  | { state: "ready"; teams: { id: string; name: string }[] }
  | { state: "unavailable" };

export function TeamLinkForm({
  links,
  appTeams,
  litellmTeams,
}: {
  links: TeamLink[];
  appTeams: AppTeamChoices;
  litellmTeams: LiteLLMTeamList;
}) {
  const queryClient = useQueryClient();
  const [teamId, setTeamId] = useState("");
  const [litellmTeamId, setLitellmTeamId] = useState("");
  const linkedApp = new Set(links.map((l) => l.teamId));
  const linkedLiteLLM = new Set(links.map((l) => l.litellmTeamId));
  const complete = teamId !== "" && litellmTeamId !== "";
  const link = useMutation({
    mutationFn: () =>
      mutateApi(
        `/api/litellm/team-links/${encodeURIComponent(teamId)}`,
        "PUT",
        { litellmTeamId, version: null },
        TeamLinkSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TEAM_LINKS_KEY });
      setTeamId("");
      setLitellmTeamId("");
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete) link.mutate();
      }}
    >
      {appTeams.state === "unavailable" ? (
        <p role="alert" className="text-destructive text-sm">
          Teams could not be loaded
        </p>
      ) : (
        <TeamLinkPicker
          label="Team"
          placeholder="Choose a team"
          value={teamId}
          onChange={setTeamId}
          options={appTeams.teams.map((team) => ({
            id: team.id,
            primary: team.name,
            secondary: team.id,
            linked: linkedApp.has(team.id),
          }))}
        />
      )}
      {litellmTeams.state === "ready" ? (
        <TeamLinkPicker
          label="LiteLLM team"
          placeholder="Choose a LiteLLM team"
          value={litellmTeamId}
          onChange={setLitellmTeamId}
          options={litellmTeams.teams.map((team) => ({
            id: team.litellmTeamId,
            primary: team.alias,
            secondary: team.litellmTeamId,
            linked: linkedLiteLLM.has(team.litellmTeamId),
          }))}
        />
      ) : (
        <p role="alert" className="text-muted-foreground text-sm">
          {litellmTeams.state === "not-configured"
            ? "LiteLLM is not connected, so LiteLLM teams cannot be listed."
            : "LiteLLM teams could not be loaded"}
        </p>
      )}
      <div>
        <Button type="submit" disabled={!complete || link.isPending}>
          Link
        </Button>
      </div>
      {link.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {link.error.message}
        </p>
      ) : null}
    </form>
  );
}
