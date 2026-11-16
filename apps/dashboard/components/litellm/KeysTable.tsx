import { formatUsd } from "@/components/charts/chart-data";
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
  return (
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
            <TableCell>{key.keyAlias ?? `…${key.tokenId.slice(-4)}`}</TableCell>
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
              {key.maxBudget === null ? "No limit" : formatUsd(key.maxBudget)}
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
  );
}
