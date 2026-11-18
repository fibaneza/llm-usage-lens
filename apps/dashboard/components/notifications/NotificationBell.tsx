"use client";

import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { NotificationList } from "./NotificationList";
import { useMarkRead, useNotifications } from "./use-notifications";

// Source: docs/specs/2026-11-10-litellm.md — MG-D13 (bell with unread count,
// polled every 60 s, paused while hidden); Rule 60.10 (never cached).
const badgeText = (count: number): string => (count > 99 ? "99+" : `${count}`);

export function NotificationBell() {
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const unread = data?.unreadCount ?? 0;

  function onOpenChange(open: boolean) {
    if (!open || !data) return;
    const ids = data.items.filter((i) => !i.read).map((i) => i.id);
    if (ids.length > 0) markRead.mutate({ ids: ids.slice(0, 50) });
  }

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications, ${unread} unread`}
        >
          <Bell aria-hidden="true" />
          {unread > 0 ? (
            <span className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-xs leading-4 font-semibold">
              {badgeText(unread)}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto"
        onInteractOutside={(event) => {
          // A decision dialog is portalled outside the popover; interacting
          // with it must not close (and unmount) the popover.
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest(
              '[role="alertdialog"], [data-slot="alert-dialog-overlay"]',
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <NotificationList items={data?.items ?? []} />
      </PopoverContent>
    </Popover>
  );
}
