import {
  Boxes,
  Building2,
  Cable,
  LayoutDashboard,
  Settings,
  Trophy,
  User,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  // Short label shown in the sidebar rail.
  title: string;
  // Descriptive heading shown in the top bar (design reference — the rail says
  // "Overview", the page heading says "Cost overview").
  pageTitle: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label: string;
  items: readonly NavItem[];
};

// Sidebar navigation, grouped per the design reference: a "Main" group for the
// Overview landing page and an "Attribution" group for the per-dimension
// breakdowns. The two detail routes (departments/[id], teams/[id]) are reached
// by drill-down and are intentionally absent — they have no standalone
// navigation target (design-system — Navigation).
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Main",
    items: [
      {
        title: "Overview",
        pageTitle: "Cost overview",
        href: "/dashboard",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: "Attribution",
    items: [
      {
        title: "Ranking",
        pageTitle: "Cost ranking",
        href: "/dashboard/ranking",
        icon: Trophy,
      },
      {
        title: "Departments",
        pageTitle: "Department breakdown",
        href: "/dashboard/departments",
        icon: Building2,
      },
      {
        title: "Teams",
        pageTitle: "Team breakdown",
        href: "/dashboard/teams",
        icon: UsersRound,
      },
      {
        title: "Services",
        pageTitle: "Service breakdown",
        href: "/dashboard/services",
        icon: Boxes,
      },
      {
        title: "Users",
        pageTitle: "User breakdown",
        href: "/dashboard/users",
        icon: User,
      },
    ],
  },
  {
    label: "Gateway",
    items: [
      {
        title: "LiteLLM",
        pageTitle: "LiteLLM usage & administration",
        href: "/dashboard/litellm",
        icon: Cable,
      },
    ],
  },
];

// Flat list of the grouped destinations — kept for callers that don't care about
// grouping (e.g. the PageTitle lookup and the Phase 2.2 command menu).
export const PRIMARY_NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap(
  (group) => group.items,
);

// Settings is pinned to the sidebar footer, separate from the primary groups.
export const SETTINGS_NAV_ITEM: NavItem = {
  title: "Settings",
  pageTitle: "Settings",
  href: "/dashboard/settings",
  icon: Settings,
};

// The full set (primary + settings) — consumed by the PageTitle lookup and
// the command menu in Phase 2.2.
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
