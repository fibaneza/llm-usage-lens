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

import { ServicesBedrockFigure } from "./ServicesBedrockFigure";
import { ServicesBody } from "./ServicesBody";
import { ServicesLiteLLMPanel } from "./ServicesLiteLLMPanel";

// Services page body (implementation-phases Phase 4.7): one table in its own
// boundary, cleared when the range changes (Rule 40.4, 60.12).
export function ServicesContent() {
  const [{ dateFrom, dateTo }] = useQueryStates(dateRangeSearchParams);
  const defaultPreset = useDefaultPreset();
  const range = useMemo(
    () => resolveUrlRange(dateFrom, dateTo, undefined, defaultPreset),
    [dateFrom, dateTo, defaultPreset],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="Cost and usage by service tag, per team." />
      <SourceFigures
        range={range}
        bedrock={<ServicesBedrockFigure range={range} />}
      />
      <BedrockSourcePanel
        boundaryTitle="the services"
        resetKeys={[range.dateFrom, range.dateTo]}
      >
        <ServicesBody range={range} urlRange={{ dateFrom, dateTo }} />
      </BedrockSourcePanel>
      <LiteLLMSourcePanel
        boundaryTitle="the LiteLLM figures"
        resetKeys={[range.dateFrom, range.dateTo]}
      >
        <ServicesLiteLLMPanel range={range} />
      </LiteLLMSourcePanel>
    </div>
  );
}
