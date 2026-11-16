import {
  Boxes,
  CircleUser,
  Building2,
  Cable,
  LayoutDashboard,
  Settings,
  Trophy,
  User,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import type { Scope } from "@/lib/auth/policy";

export type NavItem = {
  // Short label shown in the sidebar rail.
  title: string;
  // Descriptive heading shown in the top bar (the rail says "Overview", the
  // page heading says "Cost overview").
  pageTitle: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label: string;
  items: readonly NavItem[];
};

const USAGE_GROUP_LABEL = "Usage";

// Sidebar navigation (Design System - Navigation (Sidebar)): Usage is the
// organisation-level cost views followed by the caller's own usage (last),
// Management is the gateway page, Administration holds Settings. The
// two detail routes (departments/[id], teams/[id]) are reached by drill-down
// and are intentionally absent.
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: USAGE_GROUP_LABEL,
    items: [
      {
        title: "Overview",
        pageTitle: "Cost overview",
        href: "/dashboard",
        icon: LayoutDashboard,
      },
      {
        title: "Ranking",
        pageTitle: "Cost ranking",
        href: "/dashboard/ranking",
        icon: Trophy,
      },
      {
        title: "Cost by department",
        pageTitle: "Cost by department",
        href: "/dashboard/departments",
        icon: Building2,
      },
      {
        title: "Cost by team",
        pageTitle: "Cost by team",
        href: "/dashboard/teams",
        icon: UsersRound,
      },
      {
        title: "Cost by service",
        pageTitle: "Cost by service",
        href: "/dashboard/services",
        icon: Boxes,
      },
      {
        title: "Cost by user",
        pageTitle: "Cost by user",
        href: "/dashboard/users",
        icon: User,
      },
      {
        title: "My usage",
        pageTitle: "My usage",
        href: "/dashboard/me",
        icon: CircleUser,
      },
    ],
  },
  {
    label: "Management",
    items: [
      {
        title: "LiteLLM",
        pageTitle: "LiteLLM usage & administration",
        href: "/dashboard/litellm",
        icon: Cable,
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        title: "Settings",
        pageTitle: "Settings",
        href: "/dashboard/settings",
        icon: Settings,
      },
    ],
  },
];

// Flat list of every destination - consumed by the PageTitle lookup.
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap(
  (group) => group.items,
);

// Overview owns the exact "/dashboard" path; every other link also matches its
// nested detail routes (e.g. /dashboard/teams/123 highlights Cost by team).
export function isNavItemActive(pathname: string, href: string): boolean {
  const path = href.split("?")[0] ?? href;
  if (path === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export type NavScope = Pick<
  Scope,
  "global" | "memberTeamId" | "teamScopes" | "departmentScopes"
>;

const MY_USAGE_HREF = "/dashboard/me";

// The one nav filter (sidebar, PageTitle and CommandMenu share it). The Usage
// group is organisation-level except My usage, so non-global callers keep only
// My usage there; the other pages 404 for them (Access Control - Navigation
// and landing by role).
export function navGroupsFor(scope: NavScope): readonly NavGroup[] {
  if (scope.global) return NAV_GROUPS;
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        group.label !== USAGE_GROUP_LABEL || item.href === MY_USAGE_HREF,
    ),
  }));
}

export function landingPathFor(scope: NavScope): string {
  return scope.global ? "/dashboard" : "/dashboard/me";
}
