import { auth, signOut } from "@/auth";
import { SyncCountdown } from "@/components/status/SyncCountdown";
import { SyncStatusBadge } from "@/components/status/SyncStatusBadge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { env } from "@/env";
import { UserMenu } from "./UserMenu";

// The content-inset header: sidebar toggle + organization name on the left,
// sync status and the user menu on the right (design-system spec — Layout).
// Server component so it can read the Auth.js session directly.
export async function TopBar() {
  const session = await auth();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/sign-in" });
  }

  return (
    <header className="border-border flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-5" />
      <span className="font-semibold">{env.NEXT_PUBLIC_ORG_NAME}</span>
      <div className="ml-auto flex items-center gap-3">
        <SyncStatusBadge />
        <SyncCountdown />
        <UserMenu user={session?.user ?? null} signOutAction={signOutAction} />
      </div>
    </header>
  );
}
