"use client";

import { LiteLLMUserMembershipsResponseSchema } from "@llm-usage-lens/shared";
import type { LiteLLMUserMembership } from "@llm-usage-lens/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";

import { formatUsd } from "@/components/charts/chart-data";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError, fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: Design System - "Reset spend from the LiteLLM users tab and the
// Users page" (unit RS1, D1-D5); LiteLLM spec - `resetMemberSpend` row. One
// existing reset-spend POST per team membership, the same route, matrix and
// audit as the Team page; "Reset all listed" runs them one at a time and
// reports each team (a failure does not stop the rest).

const HIDDEN = "Hidden until per-user reporting is approved";
const WriteDataSchema = z.record(z.string(), z.unknown());

type Outcome = { kind: "done" } | { kind: "failed"; message: string };

type Memberships =
  | { status: "ok"; items: LiteLLMUserMembership[]; configured: boolean }
  | { status: "unavailable" };

const resetPath = (teamId: string, oid: string) =>
  `/api/litellm/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(oid)}/reset-spend`;

const userResetPath = (litellmUserId: string) =>
  `/api/litellm/users/${encodeURIComponent(litellmUserId)}/reset-spend`;

// RS2 (D-RS7, D-RS4): the user-level reset, by LiteLLM id, listed before the
// team memberships; "Reset all listed" never runs it.
function UserLevelReset({
  litellmUserId,
  busy,
}: {
  litellmUserId: string;
  busy: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  async function run() {
    setPending(true);
    try {
      await mutateApi(
        userResetPath(litellmUserId),
        "POST",
        undefined,
        WriteDataSchema,
      );
      setOutcome({ kind: "done" });
    } catch (caught) {
      if (!(caught instanceof ApiRequestError)) throw caught;
      setOutcome({ kind: "failed", message: caught.message });
    } finally {
      setPending(false);
    }
  }
  return (
    <div
      role="group"
      aria-label="User spend (all of LiteLLM)"
      className="rounded-card flex flex-col gap-2 border p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-medium">User spend (all of LiteLLM)</span>
          <p className="text-muted-foreground text-sm">
            Clears the spend counter across all of their teams.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-label="Reset user spend in all of LiteLLM"
          disabled={busy || pending || outcome?.kind === "done"}
          onClick={() => void run()}
        >
          Reset
        </Button>
      </div>
      {outcome?.kind === "done" ? (
        <p className="text-sm">Spend reset to $0.00</p>
      ) : null}
      {outcome?.kind === "failed" ? (
        <p role="alert" className="text-destructive text-sm">
          {`Failed: ${outcome.message}`}
        </p>
      ) : null}
    </div>
  );
}

function DialogBody({
  oid,
  litellmUserId,
  name,
  userReset,
  teamReset,
}: {
  oid: string | undefined;
  litellmUserId: string;
  name: string;
  userReset: boolean;
  teamReset: boolean;
}) {
  const query = useQuery({
    queryKey: ["litellm", "user", litellmUserId, "memberships"],
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<Memberships> => {
      try {
        const data = await fetchApi(
          `/api/litellm/users/${encodeURIComponent(litellmUserId)}/memberships`,
          LiteLLMUserMembershipsResponseSchema,
        );
        return {
          status: "ok",
          items: data.items,
          configured: data.configured !== false,
        };
      } catch (error) {
        if (
          error instanceof ApiRequestError &&
          error.code === "LITELLM_UNAVAILABLE"
        ) {
          return { status: "unavailable" };
        }
        throw error;
      }
    },
  });
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(
    new Map(),
  );
  const [busy, setBusy] = useState(false);

  async function reset(teamId: string): Promise<void> {
    if (oid === undefined) return;
    try {
      await mutateApi(
        resetPath(teamId, oid),
        "POST",
        undefined,
        WriteDataSchema,
      );
      setOutcomes((prev) => new Map(prev).set(teamId, { kind: "done" }));
    } catch (caught) {
      if (!(caught instanceof ApiRequestError)) throw caught;
      setOutcomes((prev) =>
        new Map(prev).set(teamId, { kind: "failed", message: caught.message }),
      );
    }
  }

  async function resetOne(teamId: string) {
    setBusy(true);
    try {
      await reset(teamId);
    } finally {
      setBusy(false);
    }
  }

  async function resetAll(items: readonly LiteLLMUserMembership[]) {
    setBusy(true);
    try {
      for (const item of items) {
        if (outcomes.get(item.teamId)?.kind === "done") continue;
        await reset(item.teamId);
      }
    } finally {
      setBusy(false);
    }
  }

  const result = query.data;
  const items =
    result?.status === "ok" && result.configured ? result.items : [];
  const footer = (
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      {teamReset && items.length > 0 && oid !== undefined ? (
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => void resetAll(items)}
        >
          Reset all listed
        </Button>
      ) : null}
    </AlertDialogFooter>
  );
  const note = (text: string) => (
    <p className="text-muted-foreground text-sm">{text}</p>
  );
  let content: ReactNode;
  if (query.isPending) {
    content = <Skeleton className="h-24 w-full" />;
  } else if (query.isError) {
    content = (
      <p role="alert" className="text-destructive text-sm">
        {query.error instanceof Error
          ? query.error.message
          : "Could not load the memberships."}
      </p>
    );
  } else if (result?.status === "unavailable") {
    content = note("LiteLLM unavailable");
  } else if (result && !result.configured) {
    content = note("LiteLLM not configured");
  } else if (items.length === 0) {
    content = note("No team you can reset spend in for this person.");
  } else {
    content = (
      <ul role="list" aria-label="Team memberships" className="space-y-3">
        {items.map((item) => {
          const outcome = outcomes.get(item.teamId);
          return (
            <li
              key={item.teamId}
              className="rounded-card flex flex-col gap-2 border p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 font-medium break-words">
                  {item.teamName}
                </span>
                {oid === undefined || !teamReset ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Reset spend in ${item.teamName}`}
                    disabled={busy || outcome?.kind === "done"}
                    onClick={() => void resetOne(item.teamId)}
                  >
                    Reset
                  </Button>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Spend</dt>
                  <dd className="font-mono tabular-nums">
                    {item.spend === undefined ? HIDDEN : formatUsd(item.spend)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Budget</dt>
                  <dd className="font-mono tabular-nums">
                    {item.spend === undefined
                      ? "—"
                      : item.maxBudget == null
                        ? "No budget"
                        : formatUsd(item.maxBudget)}
                  </dd>
                </div>
              </dl>
              {outcome?.kind === "done" ? (
                <p className="text-sm">Spend reset to $0.00</p>
              ) : null}
              {outcome?.kind === "failed" ? (
                <p role="alert" className="text-destructive text-sm">
                  {`Failed: ${outcome.message}`}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{`Reset spend for ${name}?`}</AlertDialogTitle>
        <AlertDialogDescription>
          {`Sets ${name}'s spend to $0.00 in each team listed below. A reset clears the spend counter only: usage history, cost data and the audit log do not change. Recorded in the audit log.`}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {userReset ? (
        <UserLevelReset litellmUserId={litellmUserId} busy={busy} />
      ) : null}
      {content}
      {footer}
    </>
  );
}

export function ResetMemberSpendDialog({
  oid,
  litellmUserId,
  name,
  userReset = false,
  enabledOperations,
}: {
  oid?: string;
  litellmUserId: string;
  name: string;
  userReset?: boolean;
  enabledOperations?: string[];
}) {
  const allows = (op: string) =>
    enabledOperations === undefined || enabledOperations.includes(op);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Reset spend for ${name}`}
        >
          Reset spend
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <DialogBody
          oid={oid}
          litellmUserId={litellmUserId}
          name={name}
          userReset={userReset && allows("resetUserSpend")}
          teamReset={allows("resetMemberSpend")}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}
