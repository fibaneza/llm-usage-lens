"use client";

import { formatUsd } from "@/components/charts/chart-data";
import { UserAvatar } from "@/components/display/UserAvatar";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Empty, NotConnected, Unavailable } from "./LiteLLMSection";
import { LiteLLMMembersResponseSchema } from "@llm-usage-lens/shared";
import { useLiteLLMQuery } from "./use-litellm-query";

const limit = (value: number | null) =>
  value === null ? "-" : value.toLocaleString("en-US");

// Read-only in L3: write actions arrive with the write units.
export function MembersSection({ teamId }: { teamId: string }) {
  const result = useLiteLLMQuery(
    ["team", teamId, "members"],
    `/api/litellm/teams/${encodeURIComponent(teamId)}/members`,
    LiteLLMMembersResponseSchema,
  );
  if (result.status === "unavailable") return <Unavailable />;
  const { connected, items } = result.data;
  if (!connected) return <NotConnected />;
  if (items.length === 0) return <Empty>No members in this team.</Empty>;
  return (
    <Table>
      <TableCaption className="sr-only">Team members</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead className="text-right">Spend</TableHead>
          <TableHead className="text-right">Budget</TableHead>
          <TableHead className="text-right">Requests/min</TableHead>
          <TableHead className="text-right">Tokens/min</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((member) => (
          <TableRow key={member.oid}>
            <TableCell>
              <span className="inline-flex items-center gap-2">
                <UserAvatar userId={member.email ?? member.name} />
                <span className="flex flex-col">
                  <span>{member.name}</span>
                  {member.email ? (
                    <span className="text-muted-foreground text-xs">
                      {member.email}
                    </span>
                  ) : null}
                </span>
              </span>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatUsd(member.spend)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {member.maxBudget === null
                ? "No limit"
                : formatUsd(member.maxBudget)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {limit(member.rpmLimit)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {limit(member.tpmLimit)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
