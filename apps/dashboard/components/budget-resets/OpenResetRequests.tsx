"use client";

import { format } from "date-fns";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { DecisionButtons } from "@/components/notifications/DecisionButtons";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/query/fetch-api";

import { useTeamBudgetResetRequests } from "./use-budget-reset-requests";

const when = (iso: string) => format(new Date(iso), "yyyy-MM-dd HH:mm");

function List({ teamId, canApprove }: { teamId: string; canApprove: boolean }) {
  const { data, error, isPending } = useTeamBudgetResetRequests(teamId);
  if (isPending) return <Skeleton className="h-16 w-full" />;
  // No scope on this team: nothing to show (the route answers 404).
  if (error instanceof ApiRequestError && error.status === 404) return null;
  if (error) throw error;
  // Deny stays possible with the toggles off (MG-D12), so the list shows
  // whenever there are open requests; with none and the reset off, nothing.
  if (data.items.length === 0 && !canApprove) return null;
  return (
    <section
      aria-labelledby="open-reset-requests"
      className="flex flex-col gap-3"
    >
      <h3 id="open-reset-requests" className="text-sm font-semibold">
        Budget reset requests
      </h3>
      {data.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {data.count === undefined || data.count === 0
            ? "No open requests."
            : `${data.count} open ${data.count === 1 ? "request" : "requests"}.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((request) => (
            <li
              key={request.id}
              className="border-border bg-card rounded-card flex flex-col gap-2 border p-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="font-medium">
                  {request.requester.displayName ??
                    request.requester.email ??
                    request.requester.oid}
                </span>
                {request.requester.displayName !== null &&
                request.requester.email !== null ? (
                  <span className="text-muted-foreground">
                    {request.requester.email}
                  </span>
                ) : null}
                {request.reason === null ? null : (
                  <span className="max-w-[72ch] whitespace-pre-wrap">
                    {request.reason}
                  </span>
                )}
                <span className="text-muted-foreground text-xs">
                  {`Requested ${when(request.createdAt)} · expires ${when(request.requestExpiresAt)}`}
                </span>
              </div>
              <DecisionButtons
                request={request}
                {...(canApprove
                  ? {}
                  : {
                      approveDisabledReason:
                        "Reset spend is switched off, so this can only be denied.",
                    })}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Source: docs/specs/2026-11-10-litellm.md -- "Budget reset requests". The
// list route returns only in-scope rows and the decide routes enforce the
// permission, so every row shows the buttons and the server is the control.
export function OpenResetRequests({
  teamId,
  canApprove,
}: {
  teamId: string;
  canApprove: boolean;
}) {
  return (
    <SectionBoundary title="budget reset requests" resetKeys={[teamId]}>
      <List teamId={teamId} canApprove={canApprove} />
    </SectionBoundary>
  );
}
