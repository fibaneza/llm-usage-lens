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
        title: "My usage",
        pageTitle: "My usage",
        href: "/dashboard/me",
        icon: CircleUser,
      },
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

// Source: implementation-phases Phase 4R.5; Design System - Access states and
// scoped labels. Non-global callers reach the Overview through ?view=overview
// because a bare /dashboard sends them to their landing page.
const OVERVIEW_HREF = "/dashboard";
const SCOPED_OVERVIEW_HREF = "/dashboard?view=overview";
const NO_TEAM_HREFS: ReadonlySet<string> = new Set([
  "/dashboard/me",
  "/dashboard/litellm",
]);

const hasAnyScope = (scope: NavScope) =>
  scope.memberTeamId !== null ||
  scope.teamScopes.size > 0 ||
  scope.departmentScopes.size > 0;

export function navGroupsFor(scope: NavScope): readonly NavGroup[] {
  if (scope.global) return NAV_GROUPS;
  const scoped = hasAnyScope(scope);
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => {
        if (!scoped) return NO_TEAM_HREFS.has(item.href);
        return (
          item.href !== "/dashboard/departments" ||
          scope.departmentScopes.size > 0
        );
      })
      .map((item) => {
        if (scoped && item.href === "/dashboard/teams") {
          return { ...item, title: "My teams" };
        }
        if (scoped && item.href === OVERVIEW_HREF) {
          return { ...item, href: SCOPED_OVERVIEW_HREF };
        }
        return item;
      }),
  })).filter((group) => group.items.length > 0);
}

export function landingPathFor(scope: NavScope): string {
  if (scope.global) return "/dashboard";
  const [onlyDepartment] = scope.departmentScopes;
  if (onlyDepartment !== undefined) {
    return scope.departmentScopes.size === 1
      ? `/dashboard/departments/${encodeURIComponent(onlyDepartment)}`
      : "/dashboard/departments";
  }
  if (scope.teamScopes.size > 0) return "/dashboard/teams";
  return "/dashboard/me";
}
