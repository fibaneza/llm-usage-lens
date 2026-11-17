"use client";

import { CombinedMeResponseSchema } from "@llm-usage-lens/shared";

import { CombinedBoundary } from "./CombinedBoundary";
import { CombinedPersonCard } from "./CombinedPersonCard";
import {
  combinedPath,
  useCombinedQuery,
  type CombinedRange,
} from "./use-combined-query";

function MeContent({ range }: { range: CombinedRange }) {
  const response = useCombinedQuery(
    combinedPath("me", range),
    CombinedMeResponseSchema,
  );
  return response ? (
    <CombinedPersonCard title="Your combined usage" response={response} />
  ) : null;
}

// LiteLLM spec -- Combined usage (L6), Where each figure appears: My usage.
export function CombinedMeCard({ range }: { range: CombinedRange }) {
  return (
    <CombinedBoundary
      title="your combined usage"
      resetKeys={[range.dateFrom, range.dateTo]}
    >
      <MeContent range={range} />
    </CombinedBoundary>
  );
}
