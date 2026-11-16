import { TeamLinkSchema } from "@llm-usage-lens/shared";
import type { TeamLink } from "@llm-usage-lens/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mutateApi } from "@/lib/query/fetch-api";

import { TEAM_LINKS_KEY } from "./keys";

// Source: docs/specs/2026-11-10-litellm.md -- API routes (PUT
// /api/litellm/team-links/{teamId}, versioned: null creates).
export function TeamLinkForm({ links }: { links: TeamLink[] }) {
  const queryClient = useQueryClient();
  const teamField = useId();
  const llmField = useId();
  const [teamId, setTeamId] = useState("");
  const [litellmTeamId, setLitellmTeamId] = useState("");
  const link = useMutation({
    mutationFn: () =>
      mutateApi(
        `/api/litellm/team-links/${encodeURIComponent(teamId)}`,
        "PUT",
        {
          litellmTeamId,
          version: links.find((l) => l.teamId === teamId)?.version ?? null,
        },
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
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        link.mutate();
      }}
    >
      <label htmlFor={teamField} className="text-sm font-medium">
        Dashboard team ID
      </label>
      <Input
        id={teamField}
        value={teamId}
        onChange={(e) => setTeamId(e.target.value)}
      />
      <label htmlFor={llmField} className="text-sm font-medium">
        LiteLLM team ID
      </label>
      <Input
        id={llmField}
        value={litellmTeamId}
        onChange={(e) => setLitellmTeamId(e.target.value)}
      />
      <div>
        <Button type="submit" disabled={link.isPending}>
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
