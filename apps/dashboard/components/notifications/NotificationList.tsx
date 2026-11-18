"use client";

import { formatDistanceToNowStrict } from "date-fns";
import type {
  BudgetResetRequestView,
  NotificationView,
} from "@llm-usage-lens/shared";

import { cn } from "@/lib/utils";

import { DecisionButtons } from "./DecisionButtons";

// Source: docs/specs/2026-11-10-litellm.md — MG-D13; Access Control BR7 (the
// reason renders as React text only, never HTML, a URL or a mailto) and BR8
// (no name, reason or buttons once the caller lost access).
const personName = (request: BudgetResetRequestView): string =>
  request.requester.displayName ?? request.requester.email ?? "A team member";

function headline(item: NotificationView): string {
  switch (item.kind) {
    case "budget-reset.requested":
      return item.request
        ? `Budget reset requested by ${personName(item.request)}`
        : "Budget reset requested";
    case "budget-reset.approved":
      return "Your budget reset was approved";
    case "budget-reset.denied":
      return "Your budget reset was denied";
    case "budget-reset.expired":
      return "Your budget reset request expired";
    default: {
      const unreachable: never = item.kind;
      return String(unreachable);
    }
  }
}

export function NotificationList({
  items,
  onDecided,
}: {
  items: readonly NotificationView[];
  onDecided?: () => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No notifications yet.</p>
    );
  }
  return (
    <ul className="divide-border divide-y">
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "flex flex-col gap-1 py-2",
            !item.read && "font-medium",
          )}
        >
          <span className="text-sm">{headline(item)}</span>
          <span className="text-muted-foreground text-xs font-normal">
            {formatDistanceToNowStrict(new Date(item.createdAt), {
              addSuffix: true,
            })}
          </span>
          {item.request === null ? (
            <span className="text-muted-foreground text-xs font-normal">
              You no longer have access to this request.
            </span>
          ) : item.request.reason ? (
            <span className="text-muted-foreground text-xs font-normal break-words whitespace-pre-wrap">
              {item.request.reason}
            </span>
          ) : null}
          {item.canDecide && item.request ? (
            <DecisionButtons request={item.request} onDone={onDecided} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
