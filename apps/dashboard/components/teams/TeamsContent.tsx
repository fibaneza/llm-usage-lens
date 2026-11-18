"use client";

import { parseAsString, useQueryState, useQueryStates } from "nuqs";
import { useMemo } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { BedrockSourcePanel } from "@/components/litellm/combined/BedrockSourcePanel";
import { LiteLLMSourcePanel } from "@/components/litellm/combined/LiteLLMSourcePanel";
import { SourceFigures } from "@/components/litellm/combined/SourceFigures";
import { useDefaultPreset } from "@/components/providers/DefaultPresetProvider";
import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";

import { NoAwsAccountTeams } from "./NoAwsAccountTeams";
import { TeamsBedrockFigure } from "./TeamsBedrockFigure";
import { TeamsBody } from "./TeamsBody";
import { TeamsLiteLLMPanel } from "./TeamsLiteLLMPanel";

// Teams page body (implementation-phases Phase 4.5; M5 source panels): the
// figures, then one panel per source, each in its own boundary that clears a
// failed request when the range or filter changes (Rule 40.4, 60.12).
export function TeamsContent() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const [department, setDepartment] = useQueryState(
    "department",
    parseAsString,
  );
  const defaultPreset = useDefaultPreset();
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo, undefined, defaultPreset),
    [dateFrom, dateTo, defaultPreset],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="Cost, tokens and activity for each team, filterable by department." />
      <SourceFigures
        range={range}
        bedrock={<TeamsBedrockFigure range={range} />}
      />
      <BedrockSourcePanel
        boundaryTitle="the teams"
        resetKeys={[range.dateFrom, range.dateTo, department]}
      >
        <TeamsBody
          range={range}
          urlRange={{ dateFrom, dateTo }}
          department={department}
          onDepartmentChange={(next) => void setDepartment(next)}
        />
        <NoAwsAccountTeams department={department} />
      </BedrockSourcePanel>
      <LiteLLMSourcePanel
        boundaryTitle="the LiteLLM teams"
        resetKeys={[range.dateFrom, range.dateTo]}
      >
        <TeamsLiteLLMPanel range={range} />
      </LiteLLMSourcePanel>
    </div>
  );
}
