"use client";

import { useQueryStates } from "nuqs";
import { useMemo } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { BedrockSourcePanel } from "@/components/litellm/combined/BedrockSourcePanel";
import { LiteLLMSourcePanel } from "@/components/litellm/combined/LiteLLMSourcePanel";
import { SourceFigures } from "@/components/litellm/combined/SourceFigures";
import { useDefaultPreset } from "@/components/providers/DefaultPresetProvider";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

import { UsersBedrockFigure } from "./UsersBedrockFigure";
import { UsersBody } from "./UsersBody";
import { UsersLiteLLMPanel } from "./UsersLiteLLMPanel";

// Users page body (implementation-phases Phase 4.8; M5): the three source
// figures, the Bedrock table and the LiteLLM users, each in its own boundary
// (Rule 40.4, 60.12).
export function UsersContent() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const defaultPreset = useDefaultPreset();
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo, undefined, defaultPreset),
    [dateFrom, dateTo, defaultPreset],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="Cost and usage for each person who calls Bedrock." />
      <SourceFigures
        range={range}
        bedrock={<UsersBedrockFigure range={range} />}
      />
      <BedrockSourcePanel
        boundaryTitle="the users"
        resetKeys={[range.dateFrom, range.dateTo]}
      >
        <UsersBody range={range} urlRange={{ dateFrom, dateTo }} />
      </BedrockSourcePanel>
      <LiteLLMSourcePanel boundaryTitle="the LiteLLM users" resetKeys={[]}>
        <UsersLiteLLMPanel />
      </LiteLLMSourcePanel>
    </div>
  );
}
