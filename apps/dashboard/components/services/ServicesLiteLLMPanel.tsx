"use client";

import { formatUsd } from "@/components/charts/chart-data";
import { CombinedBoundary } from "@/components/litellm/combined/CombinedBoundary";
import { LITELLM_NOT_CONFIGURED } from "@/components/litellm/combined/source-labels";
import {
  useCombinedOrganisation,
  type CombinedRange,
} from "@/components/litellm/combined/use-combined-query";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function Body({ range }: { range: CombinedRange }) {
  const response = useCombinedOrganisation(range);
  const gap = (
    <p role="note" className="text-muted-foreground text-sm">
      LiteLLM does not report cost by service.
    </p>
  );
  if (!response || response.visibility === "hidden") return gap;
  if (!response.configured || response.litellm == null) {
    return (
      <div className="flex flex-col gap-2">
        {gap}
        <p className="text-muted-foreground text-sm">
          {LITELLM_NOT_CONFIGURED}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {gap}
      <p className="text-sm font-medium">
        {`LiteLLM total ${formatUsd(response.litellm)}`}
      </p>
      {response.byProvider.length > 0 ? (
        <Table>
          <TableCaption className="sr-only">
            LiteLLM spend by provider
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Spend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {response.byProvider.map((p) => (
              <TableRow key={p.provider}>
                <TableCell>{p.provider}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatUsd(p.spend)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}

// Design System -- Source panels, D19 / Q7 = no: an honest gap, no service
// mapping from key aliases or tags.
export function ServicesLiteLLMPanel({ range }: { range: CombinedRange }) {
  return (
    <CombinedBoundary
      title="the LiteLLM figures"
      resetKeys={[range.dateFrom, range.dateTo]}
    >
      <Body range={range} />
    </CombinedBoundary>
  );
}
