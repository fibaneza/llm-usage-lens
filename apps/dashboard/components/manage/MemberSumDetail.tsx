"use client";

import type { MemberSumSchema } from "@llm-usage-lens/shared";
import type { z } from "zod";

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

export type MemberSum = z.infer<typeof MemberSumSchema>;

// App Teams spec - Member sum step 4: coverage is always shown.
export function coverageText(coverage: MemberSum["coverage"]): string {
  return `${coverage.members} members: ${coverage.matched} matched, ${coverage.unmatched} not in LiteLLM, ${coverage.pending} pending`;
}

// App Teams spec - Why the figures differ.
export function FiguresDiffer() {
  return (
    <ul className="text-cell text-muted-foreground flex max-w-[72ch] list-disc flex-col gap-1 pl-5">
      <li>
        The LiteLLM team figure is everything spent through that LiteLLM
        team&apos;s keys, including keys owned by nobody in the app team.
      </li>
      <li>
        The sum of members is everything each app member spent through the
        gateway, in any LiteLLM team and on personal keys.
      </li>
      <li>
        Membership is read as it is now. A person who moved app team carries
        their earlier spend to the new team for any date range.
      </li>
    </ul>
  );
}

// An unmatched member is never shown as $0; a matched member's spend is
// absent while the Organisation cap hides per-user cost (AT3, LD23).
export function MemberSpendTable({ members }: Pick<MemberSum, "members">) {
  return (
    <Table>
      <TableCaption className="mt-0 mb-2 text-left">
        Spend by member
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead className="text-right">Spend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => (
          <TableRow key={m.oid}>
            <TableCell>{m.name ?? m.oid}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {!m.matched
                ? "not in LiteLLM"
                : m.spend === undefined
                  ? "Not shown"
                  : formatUsd(m.spend)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
