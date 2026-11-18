"use client";

import { LiteLLMTeamDetailResponseSchema } from "@llm-usage-lens/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { formatUsd } from "@/components/charts/chart-data";
import { NOT_IN_LITELLM } from "@/components/litellm/combined/source-labels";
import type { CombinedRange } from "@/components/litellm/combined/use-combined-query";
import {
  coverageText,
  FiguresDiffer,
  MemberSpendTable,
} from "@/components/manage/MemberSumDetail";
import { Button } from "@/components/ui/button";
import { ApiRequestError, fetchApi } from "@/lib/query/fetch-api";

type Props = {
  teamId: string;
  teamName: string;
  range: CombinedRange;
  linked: boolean;
};

// Row states of the on-demand read (M5-D5). Anything else throws to the
// panel's boundary.
function errorText(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (error.status === 422 || error.code === "TOO_MANY_MEMBERS") {
    return "Too many members to sum (over 200)";
  }
  if (error.code === "OPERATION_DISABLED") return "Switched off";
  if (error.code === "LITELLM_UNAVAILABLE") return "LiteLLM unavailable";
  if (error.status === 404) return "Team not found";
  return null;
}

// App Teams spec AT6: no member read until the reader asks for it.
export function TeamSumOfMembers({ teamId, teamName, range, linked }: Props) {
  const [requested, setRequested] = useState(false);
  const query = useQuery({
    queryKey: [
      "litellm",
      "team-member-sum",
      teamId,
      range.dateFrom,
      range.dateTo,
    ],
    enabled: requested,
    retry: false,
    queryFn: () =>
      fetchApi(
        `/api/litellm/teams/${encodeURIComponent(teamId)}?dateFrom=${range.dateFrom}&dateTo=${range.dateTo}&include=memberSum`,
        LiteLLMTeamDetailResponseSchema,
      ),
  });

  if (!requested) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Sum of members for ${teamName}`}
        onClick={() => setRequested(true)}
      >
        Sum of members
      </Button>
    );
  }
  if (query.isError) {
    const text = errorText(query.error);
    if (text === null) throw query.error;
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {text}
      </p>
    );
  }
  if (query.data === undefined) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Loading…
      </p>
    );
  }

  const memberSum =
    "memberSum" in query.data ? query.data.memberSum : undefined;
  if (memberSum === undefined) {
    return <p className="text-muted-foreground text-sm">Not available</p>;
  }
  const unmatched = memberSum.members.filter((m) => !m.matched).length;
  return (
    <div className="flex flex-col gap-2 text-left">
      <p className="font-mono tabular-nums">
        <span className="sr-only">{`Sum of members for ${teamName}: `}</span>
        {formatUsd(memberSum.total)}
      </p>
      <p className="text-muted-foreground text-xs">
        {coverageText(memberSum.coverage)}
      </p>
      {linked ? <FiguresDiffer /> : null}
      {memberSum.members.length > 0 ? (
        <details>
          <summary className="text-muted-foreground cursor-pointer text-xs">
            {`Members (${unmatched} ${NOT_IN_LITELLM})`}
          </summary>
          <MemberSpendTable members={memberSum.members} />
        </details>
      ) : null}
    </div>
  );
}
