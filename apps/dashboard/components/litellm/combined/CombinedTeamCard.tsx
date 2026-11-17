"use client";

import { CombinedTeamResponseSchema } from "@llm-usage-lens/shared";

import { Panel } from "@/components/display/Panel";

import { CombinedBoundary } from "./CombinedBoundary";
import { CombinedFigure } from "./CombinedFigure";
import { CombinedWarning } from "./CombinedWarning";
import { formatUsd } from "@/components/charts/chart-data";
import {
  combinedPath,
  useCombinedQuery,
  type CombinedRange,
} from "./use-combined-query";

function TeamContent({
  teamId,
  range,
}: {
  teamId: string;
  range: CombinedRange;
}) {
  const response = useCombinedQuery(
    combinedPath(`teams/${encodeURIComponent(teamId)}`, range),
    CombinedTeamResponseSchema,
    { missingIsNull: true },
  );
  if (!response || response.visibility === "hidden") return null;
  // An unlinked team gets no card; a missing team is the page's own state.
  if (response.reason === "not-linked") return null;
  const { litellm, combined } = response;
  return (
    <Panel title="Combined usage" boundaryTitle="combined usage">
      <div className="flex flex-col gap-3">
        {response.visibility === "warn" ? <CombinedWarning /> : null}
        {!response.configured || litellm === null || combined === null ? (
          <p className="text-muted-foreground text-sm">
            LiteLLM not configured
          </p>
        ) : (
          <CombinedFigure
            combined={combined}
            bedrockDirect={response.bedrockDirect}
            litellm={litellm}
            costEstimated={response.costEstimated}
            provisional={response.provisional}
          />
        )}
        {response.gatewaySlice > 0 ? (
          <p className="text-cell text-muted-foreground">
            {`Billed via LiteLLM ${formatUsd(response.gatewaySlice)}`}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

// LiteLLM spec -- Combined usage (L6), Where each figure appears: Team Detail.
export function CombinedTeamCard({
  teamId,
  range,
}: {
  teamId: string;
  range: CombinedRange;
}) {
  return (
    <CombinedBoundary
      title="combined usage"
      fallback={<></>}
      resetKeys={[teamId, range.dateFrom, range.dateTo]}
    >
      <TeamContent teamId={teamId} range={range} />
    </CombinedBoundary>
  );
}
