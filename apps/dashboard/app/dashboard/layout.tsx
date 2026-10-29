import { type CSSProperties, type ReactNode, Suspense } from "react";

import { AppHeader } from "@/components/layout/AppHeader";
import { AppSidebar, AppSidebarFallback } from "@/components/layout/AppSidebar";
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
      {/* AppSidebar reads the URL via useSearchParams (issue #75 — carries the
          date range onto nav links), so it sits under Suspense for static
          prerender (Rule 60.12); the fallback is the same rail with bare hrefs. */}
      <Suspense fallback={<AppSidebarFallback />}>
        <AppSidebar />
      </Suspense>
      <SidebarInset className="min-w-0">
        <AppHeader />
        <div className="mx-auto w-full max-w-[1280px] flex-1 p-4 md:p-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
