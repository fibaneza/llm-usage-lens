"use client";

import { formatUsd } from "@/components/charts/chart-data";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { formatSydneyTime } from "./sydney-time";

type KeyRow = {
  tokenId: string;
  keyAlias?: string | null;
  models: readonly string[];
  spend: number;
  maxBudget: number | null;
  expires: string | null;
  blocked: boolean;
};

// Key metadata only -- the alias and token id, never a key value (LiteLLM spec
// -- Security architecture; Design System -- LiteLLM Page, Keys).
export function KeysTable({
  keys,
  caption,
}: {
  keys: readonly KeyRow[];
  caption: string;
}) {
  const isMobile = useIsMobile();
  return (
    <>
      {isMobile ? (
        <ul role="list" aria-label={caption} className="space-y-3">
          {keys.map((key) => (
            <li
              key={key.tokenId}
              className="bg-card text-card-foreground rounded-card space-y-3 border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 font-medium break-words">
                  {key.keyAlias ?? `…${key.tokenId.slice(-4)}`}
                </div>
                <div className="shrink-0 text-base font-semibold">
                  <span className="sr-only">Spend</span>
                  <span className="font-mono tabular-nums">
                    {formatUsd(key.spend)}
                  </span>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="col-span-2 min-w-0">
                  <dt className="text-muted-foreground text-xs">Models</dt>
                  <dd className="flex flex-wrap gap-1">
                    {key.models.map((model) => (
                      <Badge key={model} variant="outline">
                        {model}
                      </Badge>
                    ))}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Budget</dt>
                  <dd className="font-mono tabular-nums">
                    {key.maxBudget === null
                      ? "No limit"
                      : formatUsd(key.maxBudget)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Expires</dt>
                  <dd>{formatSydneyTime(key.expires)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Status</dt>
                  <dd>
                    {key.blocked ? (
                      <Badge variant="destructive">Blocked</Badge>
                    ) : (
                      "Active"
                    )}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <Table>
            <TableCaption className="sr-only">{caption}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Alias</TableHead>
                <TableHead>Models</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.tokenId}>
                  <TableCell>
                    {key.keyAlias ?? `…${key.tokenId.slice(-4)}`}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="flex flex-wrap gap-1">
                      {key.models.map((model) => (
                        <Badge key={model} variant="outline">
                          {model}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {key.maxBudget === null
                      ? "No limit"
                      : formatUsd(key.maxBudget)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatUsd(key.spend)}
                  </TableCell>
                  <TableCell>{formatSydneyTime(key.expires)}</TableCell>
                  <TableCell>
                    {key.blocked ? (
                      <Badge variant="destructive">Blocked</Badge>
                    ) : (
                      "Active"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
