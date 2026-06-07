import { type CSSProperties, type ReactNode } from "react";

import { AppHeader } from "@/components/layout/AppHeader";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// Shell: a full-width top header (static brand + active page title + actions)
// over a collapsible sidebar and the content inset. --header-height is shared
// so the fixed sidebar starts below the header. Content is capped at 1280px and
// centered (design-system spec — Layout). Every dashboard page renders here.
export default function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <SidebarProvider
      className="flex-col"
      style={{ "--header-height": "3.5rem" } as CSSProperties}
    >
      <AppHeader />
      <div className="flex flex-1">
        <AppSidebar />
        <SidebarInset>
          <div className="mx-auto w-full max-w-[1280px] flex-1 p-4 md:p-6">
            {children}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
