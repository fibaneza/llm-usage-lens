import { Gauge } from "lucide-react";
import Link from "next/link";

import { auth, signOut } from "@/auth";
import { PageTitle } from "@/components/layout/PageTitle";
import { SyncCountdown } from "@/components/status/SyncCountdown";
import { SyncStatusBadge } from "@/components/status/SyncStatusBadge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { env } from "@/env";
import { UserMenu } from "./UserMenu";

// Full-width top bar: a static brand (logo + product + org name) pinned
// top-left that does not collapse with the sidebar, the active page title, and
// sync/account actions on the right (design-system spec — Layout). Server
// component so it can read the Auth.js session.
export async function AppHeader() {
  const session = await auth();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/sign-in" });
  }

  return (
    <header className="bg-card border-border sticky top-0 z-30 flex h-(--header-height) shrink-0 items-center gap-3 border-b px-4">
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5"
        aria-label="Bedrock Cost — go to overview"
      >
        <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
          <Gauge className="size-5" />
        </div>
        <div className="flex flex-col gap-0.5 leading-none">
          <span className="font-semibold">Bedrock Cost</span>
          <span className="text-primary text-[11px] font-medium tracking-wide uppercase">
            {env.NEXT_PUBLIC_ORG_NAME}
          </span>
        </div>
      </Link>

      <Separator orientation="vertical" className="mx-1 h-6" />
      <SidebarTrigger className="md:hidden" />
      <PageTitle className="hidden sm:block" />

      <div className="ml-auto flex items-center gap-3">
        <SyncStatusBadge />
        <SyncCountdown />
        <UserMenu user={session?.user ?? null} signOutAction={signOutAction} />
      </div>
    </header>
  );
}
