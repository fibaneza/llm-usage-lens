"use client";

import { LiteLLMProxyTeamMembersResponseSchema } from "@llm-usage-lens/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { formatUsd } from "@/components/charts/chart-data";
import { ConfirmAction } from "@/components/litellm/team/write-parts";
import { PanelSkeleton } from "@/components/settings/litellm-panel/PanelSkeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiRequestError, fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: LiteLLM spec - API routes (GET /api/litellm/proxy-teams/[id]/members,
// the two member POST routes, RS2 D-RS4, D-RS6); Design System - "Reset any
// LiteLLM user" (D-RS7). A LiteLLM team's members by LiteLLM id, each with
// Reset spend and Reset budget when the caller may write and the operation is on.
const WriteDataSchema = z.record(z.string(), z.unknown());

export function LiteLLMTeamMembersPanel({
  litellmTeamId,
  teamName,
  canReset,
}: {
  litellmTeamId: string;
  teamName: string;
  canReset: boolean;
}) {
  const queryClient = useQueryClient();
  const key = ["litellm", "proxy-team-members", litellmTeamId];
  const base = `/api/litellm/proxy-teams/${encodeURIComponent(litellmTeamId)}/members`;
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchApi(base, LiteLLMProxyTeamMembersResponseSchema),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (query.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {query.error.message}
      </p>
    );
  }
  if (query.data === undefined) return <PanelSkeleton />;
  const { items, enabledOperations } = query.data;
  const ops = new Set(enabledOperations);
  const truncated = "truncated" in query.data && query.data.truncated === true;
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {`No members in ${teamName}.`}
      </p>
    );
  }

  async function reset(userId: string, action: string) {
    setPending(true);
    setError(null);
    try {
      await mutateApi(
        `${base}/${encodeURIComponent(userId)}/${action}`,
        "POST",
        undefined,
        WriteDataSchema,
      );
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (caught) {
      if (!(caught instanceof ApiRequestError)) throw caught;
      setError(caught.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {truncated ? (
        <p className="text-muted-foreground text-sm">
          Only the first 200 members are listed.
        </p>
      ) : null}
      <Table>
        <TableCaption className="sr-only">{`Members of ${teamName}`}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Dashboard user</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Budget</TableHead>
            {canReset ? <TableHead>Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const label = item.person?.name ?? item.email;
            return (
              <TableRow key={item.userId}>
                <TableCell className="break-all">{item.email}</TableCell>
                <TableCell>{item.person?.name ?? "Not linked"}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {item.spend === undefined ? "-" : formatUsd(item.spend)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {item.spend === undefined
                    ? "-"
                    : item.maxBudget == null
                      ? "No budget"
                      : formatUsd(item.maxBudget)}
                </TableCell>
                {canReset ? (
                  <TableCell>
                    <span className="flex flex-wrap gap-2">
                      {ops.has("resetMemberSpend") ? (
                        <ConfirmAction
                          label={`Reset spend for ${label}`}
                          text="Reset spend"
                          title={`Reset spend for ${label}?`}
                          description={`Sets ${label}'s spend to $0.00 in ${teamName}. Usage history, cost data and the audit log do not change. Recorded in the audit log.`}
                          disabled={pending}
                          onConfirm={() =>
                            void reset(item.userId, "reset-spend")
                          }
                        />
                      ) : null}
                      {ops.has("resetMemberBudget") ? (
                        <ConfirmAction
                          label={`Reset budget for ${label}`}
                          text="Reset budget"
                          title={`Reset budget for ${label}?`}
                          description="The member's budget period restarts."
                          disabled={pending}
                          onConfirm={() =>
                            void reset(item.userId, "reset-budget")
                          }
                        />
                      ) : null}
                    </span>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
