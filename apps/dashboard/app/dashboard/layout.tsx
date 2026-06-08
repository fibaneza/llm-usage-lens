import { type CSSProperties, type ReactNode } from "react";

import { AppHeader } from "@/components/layout/AppHeader";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// Shell: a collapsible sidebar (brand + grouped nav) beside the content inset.
// The inset opens with its own top bar (page title + sync status, account
// actions); content is capped at 1280px and centered (design reference —
// sidebar + main with an in-content top bar). --header-height aligns the
// sidebar's brand header with the inset's top bar. Every dashboard page renders
// here.
export default function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <SidebarProvider style={{ "--header-height": "3.5rem" } as CSSProperties}>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <div className="mx-auto w-full max-w-[1280px] flex-1 p-4 md:p-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
