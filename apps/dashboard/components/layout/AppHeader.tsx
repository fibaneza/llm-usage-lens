import { auth, signOut } from "@/auth";
import { PageTitle } from "@/components/layout/PageTitle";
import { SyncCountdown } from "@/components/status/SyncCountdown";
import { SyncStatusBadge } from "@/components/status/SyncStatusBadge";
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
    <header className="bg-card border-border sticky top-0 z-30 flex h-(--header-height) shrink-0 items-center gap-3 border-b px-4 md:px-6">
      {/* Desktop collapses via the sidebar's own footer control; on mobile the
          sidebar is an overlay, so the trigger is the only way in. */}
      <SidebarTrigger className="-ml-1 md:hidden" />
      {/* Title + sync badge read as one unit (design reference — the sync
          status sits next to the page heading, not across the bar). */}
      <div className="flex items-center gap-3">
        <PageTitle />
        <SyncStatusBadge />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <SyncCountdown />
        <UserMenu user={session?.user ?? null} signOutAction={signOutAction} />
      </div>
    </header>
  );
}
