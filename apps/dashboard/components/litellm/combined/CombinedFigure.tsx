"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { formatUsd } from "@/components/charts/chart-data";
import { LiteLLMReportedBadge } from "@/components/litellm/LiteLLMReportedBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type CombinedFigureProps = {
  combined: number;
  bedrockDirect: number;
  litellm: number;
  byProvider?: readonly { provider: string; spend: number }[];
  costEstimated: boolean;
  provisional: boolean;
};

// LiteLLM spec -- Combined usage (L6), UI pieces: the parts are always text,
// the provider split is a click disclosure (not hover; WCAG 1.4.13), and no
// state is colour-only.
export function CombinedFigure({
  combined,
  bedrockDirect,
  litellm,
  byProvider = [],
  costEstimated,
  provisional,
}: CombinedFigureProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="combined-total"
          className="text-kpi font-mono font-semibold tabular-nums"
        >
          {formatUsd(combined)}
        </span>
        {costEstimated ? (
          <Badge variant="outline">Includes estimates</Badge>
        ) : null}
      </div>
      <p
        data-testid="combined-parts"
        className="text-cell text-muted-foreground flex flex-wrap items-center gap-x-2"
      >
        <span>{`Direct Bedrock ${formatUsd(bedrockDirect)} · Via LiteLLM ${formatUsd(litellm)}`}</span>
        <LiteLLMReportedBadge />
      </p>
      {provisional ? (
        <p className="text-cell text-muted-foreground">
          Provisional: recent days are not final.
        </p>
      ) : null}
      {byProvider.length > 0 ? (
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown
              aria-hidden="true"
              className={open ? "rotate-180" : undefined}
            />
            Provider split
          </Button>
          {open ? (
            <ul id={listId} className="text-cell flex flex-col gap-1">
              {byProvider.map((p) => (
                <li
                  key={p.provider}
                  className="flex justify-between gap-4 font-mono tabular-nums"
                >
                  <span>{p.provider}</span>
                  <span>{formatUsd(p.spend)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
