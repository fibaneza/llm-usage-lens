"use client";

import { CombinedOrganisationResponseSchema } from "@llm-usage-lens/shared";

import { formatUsd } from "@/components/charts/chart-data";
import { Panel } from "@/components/display/Panel";
import { Badge } from "@/components/ui/badge";

import { CombinedBoundary } from "./CombinedBoundary";
import { CombinedFigure } from "./CombinedFigure";
import { CombinedWarning } from "./CombinedWarning";
import {
  combinedPath,
  useCombinedQuery,
  type CombinedRange,
} from "./use-combined-query";

type Reconciliation = { difference: number; differencePct: number | null };

// The sign is stated in words, never by colour alone (LiteLLM spec -- UI
// pieces).
function reconciliationText({ difference, differencePct }: Reconciliation) {
  if (Math.round(difference * 100) === 0) return "Billed and reported match";
  const words = difference > 0 ? "more" : "less";
  const pct =
    differencePct === null
      ? ""
      : ` (${(Math.abs(differencePct) * 100).toFixed(1)}%)`;
  return `${formatUsd(Math.abs(difference))} ${words} billed than reported${pct}`;
}

function OrganisationContent({ range }: { range: CombinedRange }) {
  const response = useCombinedQuery(
    combinedPath("organisation", range),
    CombinedOrganisationResponseSchema,
  );
  if (!response || response.visibility === "hidden") return null;
  const { litellm, combined } = response;
  return (
    <Panel
      title="Combined usage"
      boundaryTitle="combined usage"
      badge={<Badge variant="outline">UTC days</Badge>}
    >
      <div className="flex flex-col gap-3">
        {response.visibility === "warn" ? <CombinedWarning /> : null}
        {!response.configured || litellm === null || combined === null ? (
          <>
            <p className="text-muted-foreground text-sm">
              LiteLLM not configured
            </p>
            <p className="text-cell text-muted-foreground">
              {`Bedrock ${formatUsd(response.bedrockExact)}`}
            </p>
          </>
        ) : (
          <>
            <CombinedFigure
              combined={combined}
              bedrockDirect={response.bedrockDirect}
              litellm={litellm}
              byProvider={response.byProvider}
              costEstimated={response.costEstimated}
              provisional={response.provisional}
            />
            <p className="text-cell text-muted-foreground">
              {`Billed via LiteLLM ${formatUsd(response.gatewaySlice)}`}
            </p>
            {response.reconciliation ? (
              <p className="text-cell text-muted-foreground">
                {reconciliationText(response.reconciliation)}
              </p>
            ) : null}
            <p className="text-cell text-muted-foreground">
              LiteLLM teams only: spend on keys outside any team is not
              included.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

// LiteLLM spec -- Combined usage (L6), Where each figure appears: Overview.
export function CombinedOrganisationSection({
  range,
}: {
  range: CombinedRange;
}) {
  return (
    <CombinedBoundary
      title="combined usage"
      resetKeys={[range.dateFrom, range.dateTo]}
    >
      <OrganisationContent range={range} />
    </CombinedBoundary>
  );
}
