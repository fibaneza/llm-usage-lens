import { formatUsd } from "@/components/charts/chart-data";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DailySpendProps = {
  daily: readonly { date: string; spend: number }[];
};

// LD20: daily buckets are LiteLLM's UTC days, labelled as such.
export function DailySpend({ daily }: DailySpendProps) {
  if (daily.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No daily spend reported.</p>
    );
  }
  return (
    <Table>
      <TableCaption className="mt-0 mb-2 text-left">
        Daily spend by UTC day
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Date (UTC)</TableHead>
          <TableHead className="text-right">Spend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {daily.map((day) => (
          <TableRow key={day.date}>
            <TableCell className="font-mono tabular-nums">{day.date}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatUsd(day.spend)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
