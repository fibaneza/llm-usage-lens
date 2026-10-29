import { Suspense } from "react";

import { auth, signOut } from "@/auth";
import { DateRangePicker } from "@/components/filters/DateRangePicker";
import { CommandMenu } from "@/components/layout/CommandMenu";
import { PageTitle } from "@/components/layout/PageTitle";
import { SyncCountdown } from "@/components/status/SyncCountdown";
import { SyncStatusBadge } from "@/components/status/SyncStatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { UserMenu } from "./UserMenu";

// Top bar sitting inside the content inset, to the right of the sidebar (the
// brand now lives in the sidebar header). The active page title and its sync
// status badge sit together on the left; sync countdown and the account menu
// sit on the right (design reference — TopBar). Server component so it can read
// the Auth.js session.
export async function AppHeader() {
  const session = await auth();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/sign-in" });
  }

  return (
    <header className="bg-card border-border sticky top-0 z-30 flex min-h-(--header-height) shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 md:flex-nowrap md:px-6">
      {/* Desktop collapses via the sidebar's own footer control; on mobile the
          sidebar is an overlay, so the trigger is the only way in. */}
      <SidebarTrigger className="-ml-1 md:hidden" />
      {/* Title + sync badge read as one unit (design reference — the sync
          status sits next to the page heading, not across the bar). CommandMenu
          is a client component embedded in this server header — fine, the
          boundary stays as deep as possible (Rule 60.7). */}
      <div className="flex min-w-0 items-center gap-3 md:flex-1">
        <PageTitle className="min-w-0 md:truncate" />
        <SyncStatusBadge />
      </div>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2 md:shrink-0 md:flex-nowrap">
        {/* Global date filter lives in the top bar (design reference — the
            7D/30D/90D toggle sits beside the account controls). It reads the URL
            via nuqs (useSearchParams), so it sits under a Suspense boundary for
            static prerender (Rule 60.12). */}
        <Suspense fallback={<DateRangePickerSkeleton />}>
          <DateRangePicker />
        </Suspense>
        {/* CommandMenu also reads the URL (useSearchParams) to carry the date
            range onto quick-jumps (issue #75), so it too needs a Suspense
            boundary for static prerender (Rule 60.12). */}
        <Suspense fallback={<CommandMenuSkeleton />}>
          <CommandMenu />
        </Suspense>
        <SyncCountdown />
        <UserMenu user={session?.user ?? null} signOutAction={signOutAction} />
      </div>
    </header>
  );
}

function DateRangePickerSkeleton() {
  return (
    <div className="border-border flex items-center gap-1 rounded-lg border p-1">
      <Skeleton className="h-7 w-10" />
      <Skeleton className="h-7 w-10" />
      <Skeleton className="h-7 w-10" />
      <Skeleton className="h-7 w-20" />
    </div>
  );
}

function CommandMenuSkeleton() {
  return (
    <Skeleton className="h-9 w-full max-w-56 rounded-md md:max-[1440px]:w-9" />
  );
}
