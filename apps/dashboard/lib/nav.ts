import {
  Boxes,
  Building2,
  LayoutDashboard,
  Settings,
  Trophy,
  User,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

// Primary destinations shown in the sidebar's main group. The two detail routes
// (departments/[id], teams/[id]) are reached by drill-down and are intentionally
// absent — they have no standalone navigation target (design-system — Navigation).
export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { title: "Ranking", href: "/dashboard/ranking", icon: Trophy },
  { title: "Departments", href: "/dashboard/departments", icon: Building2 },
  { title: "Teams", href: "/dashboard/teams", icon: UsersRound },
  { title: "Services", href: "/dashboard/services", icon: Boxes },
  { title: "Users", href: "/dashboard/users", icon: User },
];

// Settings is pinned to the sidebar footer, separate from the primary group.
export const SETTINGS_NAV_ITEM: NavItem = {
  title: "Settings",
  href: "/dashboard/settings",
  icon: Settings,
};

// The full set (primary + settings) — consumed by Breadcrumbs and the command
// menu in Phase 2.2.
export const NAV_ITEMS: readonly NavItem[] = [
  ...PRIMARY_NAV_ITEMS,
  SETTINGS_NAV_ITEM,
];

// Overview owns the exact "/dashboard" path; every other link also matches its
// nested detail routes (e.g. /dashboard/teams/123 highlights Teams).
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
