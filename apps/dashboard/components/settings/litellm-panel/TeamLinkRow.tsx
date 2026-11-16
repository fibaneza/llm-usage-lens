import type { TeamLink } from "@llm-usage-lens/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { mutateApi } from "@/lib/query/fetch-api";

import { TEAM_LINKS_KEY } from "./keys";

const UnlinkResultSchema = z.object({ teamId: z.string() });

// Source: docs/specs/2026-11-10-litellm.md -- API routes (DELETE
// /api/litellm/team-links/{teamId} reads no body). Confirmation is inline,
// never a browser dialog.
export function TeamLinkRow({
  link,
  canEdit,
}: {
  link: TeamLink;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const unlink = useMutation({
    mutationFn: () =>
      mutateApi(
        `/api/litellm/team-links/${encodeURIComponent(link.teamId)}`,
        "DELETE",
        undefined,
        UnlinkResultSchema,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: TEAM_LINKS_KEY }),
  });
  return (
    <li className="flex flex-col gap-1 py-1 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono">{link.teamId}</span>
        <span className="text-muted-foreground font-mono">
          {link.litellmTeamId}
        </span>
        {canEdit && !confirming ? (
          <Button
            type="button"
            variant="outline"
            aria-label={`Unlink ${link.teamId}`}
            onClick={() => setConfirming(true)}
          >
            Unlink
          </Button>
        ) : null}
      </div>
      {canEdit && confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="destructive"
            disabled={unlink.isPending}
            onClick={() => unlink.mutate()}
          >
            Confirm unlink
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setConfirming(false);
              unlink.reset();
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {unlink.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {unlink.error.message}
        </p>
      ) : null}
    </li>
  );
}
