"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const EXPLANATION =
  "Calculated by LiteLLM from its price map; not billed cost.";

// Design System -- LiteLLM Page, "Provenance label"; LiteLLM spec -- Cost
// visualisation and provenance (LT8): every LiteLLM-only figure carries it.
export function LiteLLMReportedBadge() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            tabIndex={0}
            className="text-muted-foreground font-normal"
          >
            LiteLLM-reported
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{EXPLANATION}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
