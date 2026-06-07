"use client";

import { usePathname } from "next/navigation";

import { isNavItemActive, NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

// The current page name, derived from the active nav item — the page's single
// <h1> (the route pages render content without a duplicate heading).
export function PageTitle({ className }: { className?: string }) {
  const pathname = usePathname();
  const active = NAV_ITEMS.find((item) => isNavItemActive(pathname, item.href));

  return (
    <h1 className={cn("text-base font-semibold", className)}>
      {active?.title ?? "Dashboard"}
    </h1>
  );
}
