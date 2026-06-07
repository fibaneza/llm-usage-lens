import type { ReactNode } from "react";

import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// The persistent application shell: a collapsible sidebar (persistent on
// desktop, overlay on mobile via SidebarProvider) beside the content inset,
// whose header holds the top bar. Content is capped at 1280px and centered
// (design-system spec — Layout). Every dashboard page renders inside this.
export default function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <TopBar />
        <main className="mx-auto w-full max-w-[1280px] flex-1 p-4 md:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
