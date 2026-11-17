"use client";

import type { CombinedMeResponse } from "@llm-usage-lens/shared";

import { Panel } from "@/components/display/Panel";

import { CombinedFigure } from "./CombinedFigure";
import { CombinedWarning } from "./CombinedWarning";
import { formatUsd } from "@/components/charts/chart-data";

// The one presentational card for a person's combined figure (LiteLLM spec --
// Combined usage (L6), States and Visibility): My usage and the selected user
// on Management -> Users share it. A hidden response renders nothing.
export function CombinedPersonCard({
  title,
  response,
  headingLevel = 2,
}: {
  title: string;
  response: CombinedMeResponse;
  headingLevel?: 2 | 3;
}) {
  if (response.visibility === "hidden") return null;
  const { litellm, combined } = response;
  return (
    <Panel
      title={title}
      boundaryTitle={title.toLowerCase()}
      headingLevel={headingLevel}
    >
      <div className="flex flex-col gap-3">
        {response.visibility === "warn" ? <CombinedWarning /> : null}
        {!response.configured || litellm === null || combined === null ? (
          <>
            <p className="text-muted-foreground text-sm">
              LiteLLM not configured
            </p>
            <p className="text-cell text-muted-foreground">
              {`Direct Bedrock ${formatUsd(response.bedrockDirect)}`}
            </p>
          </>
        ) : (
          <>
            <CombinedFigure
              combined={combined}
              bedrockDirect={response.bedrockDirect}
              litellm={litellm}
              costEstimated={response.costEstimated}
              provisional={response.provisional}
            />
            {!response.litellmUser ? (
              <p className="text-cell text-muted-foreground">No LiteLLM user</p>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  );
}
