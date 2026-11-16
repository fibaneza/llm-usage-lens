"use client";

import { usePathname } from "next/navigation";

import { isNavItemActive, NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

// The descriptive page heading, derived from the active nav item — the page's
// single <h1> (the route pages render content without a duplicate heading). Uses
// the nav item's `pageTitle` so the heading is more informative than the short
// sidebar label (design reference — "Cost overview", not "Overview").
// Routes with no rail item (Design System - Navigation (Sidebar), Account row).
const OFF_RAIL_TITLES: readonly { href: string; title: string }[] = [
  { href: "/dashboard/account", title: "Account" },
];

export function PageTitle({ className }: { className?: string }) {
  const pathname = usePathname();
  const active = NAV_ITEMS.find((item) => isNavItemActive(pathname, item.href));
  const offRail = OFF_RAIL_TITLES.find((item) =>
    isNavItemActive(pathname, item.href),
  );

  const title = active?.pageTitle ?? offRail?.title ?? "Dashboard";

  return (
    <h1
      title={title}
      className={cn(
        "text-foreground text-lg font-semibold tracking-tight",
        className,
      )}
    >
      {title}
    </h1>
  );
}
