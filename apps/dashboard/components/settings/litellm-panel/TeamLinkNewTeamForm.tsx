import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mutateApi } from "@/lib/query/fetch-api";

import { TEAM_LINKS_KEY } from "./keys";
import type { AppTeamChoices } from "./TeamLinkForm";
import { TeamLinkPicker } from "./TeamLinkPicker";

const CreatedTeamSchema = z.object({
  teamId: z.string(),
  litellmTeamId: z.string(),
});

// Source: docs/specs/2026-11-10-litellm.md -- API routes (POST
// /api/litellm/teams: createTeam + link, Admin only, LD24); Design System --
// Management pages, LiteLLM area. Rendered for internal-admin only; the route
// answers 403 to anyone else (Rule 10.3).
export function TeamLinkNewTeamForm({
  links,
  appTeams,
}: {
  links: readonly { teamId: string }[];
  appTeams: AppTeamChoices;
}) {
  const queryClient = useQueryClient();
  const aliasField = useId();
  const [teamId, setTeamId] = useState("");
  const [alias, setAlias] = useState("");
  const linked = new Set(links.map((l) => l.teamId));
  const complete = teamId !== "" && alias.trim() !== "";
  const create = useMutation({
    mutationFn: () =>
      mutateApi(
        "/api/litellm/teams",
        "POST",
        { teamId, teamAlias: alias.trim() },
        CreatedTeamSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TEAM_LINKS_KEY });
      setTeamId("");
      setAlias("");
    },
  });
  return (
    <form
      aria-label="New LiteLLM team"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete) create.mutate();
      }}
    >
      <h3 className="text-sm font-semibold">New LiteLLM team</h3>
      {appTeams.state === "unavailable" ? (
        <p role="alert" className="text-destructive text-sm">
          Teams could not be loaded
        </p>
      ) : (
        <TeamLinkPicker
          label="Team to create it for"
          placeholder="Choose a team"
          value={teamId}
          onChange={setTeamId}
          options={appTeams.teams.map((team) => ({
            id: team.id,
            primary: team.name,
            secondary: team.id,
            linked: linked.has(team.id),
          }))}
        />
      )}
      <label htmlFor={aliasField} className="text-sm font-medium">
        LiteLLM team alias
      </label>
      <Input
        id={aliasField}
        value={alias}
        onChange={(e) => setAlias(e.target.value)}
      />
      <div>
        <Button type="submit" disabled={!complete || create.isPending}>
          New LiteLLM team
        </Button>
      </div>
      {create.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {create.error.message}
        </p>
      ) : null}
    </form>
  );
}
