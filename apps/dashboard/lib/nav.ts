import {
  Boxes,
  CircleUser,
  Building2,
  FileClock,
  LayoutDashboard,
  Settings,
  Trophy,
  User,
  UserSearch,
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
const MANAGEMENT_GROUP_LABEL = "Management";

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
    label: MANAGEMENT_GROUP_LABEL,
    items: [
      {
        title: "Team",
        pageTitle: "Team usage & management",
        href: "/dashboard/manage/team",
        icon: UsersRound,
      },
      {
        title: "Organisation",
        pageTitle: "Organisation usage",
        href: "/dashboard/manage/organisation",
        icon: Building2,
      },
      {
        title: "Users",
        pageTitle: "User lookup",
        href: "/dashboard/manage/users",
        icon: UserSearch,
      },
      {
        title: "Audit",
        pageTitle: "Audit log",
        href: "/dashboard/manage/audit",
        icon: FileClock,
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

// Which Management pages and Settings the caller may open, resolved on the
// server (lib/manage-access.ts) and passed down as plain flags. Absent flags
// mean false: the nav fails closed (slice B2, B2-1, B2-2).
export type ManagementNav = {
  team: boolean;
  organisation: boolean;
  users: boolean;
  audit: boolean;
  settings: boolean;
};

export type NavScope = Pick<
  Scope,
  "global" | "memberTeamId" | "teamScopes" | "departmentScopes"
> & { management?: ManagementNav };

const MY_USAGE_HREF = "/dashboard/me";

const MANAGEMENT_FLAG_BY_HREF: Readonly<Record<string, keyof ManagementNav>> = {
  "/dashboard/manage/team": "team",
  "/dashboard/manage/organisation": "organisation",
  "/dashboard/manage/users": "users",
  "/dashboard/manage/audit": "audit",
  "/dashboard/settings": "settings",
};

// The one nav filter (sidebar, PageTitle and CommandMenu share it). The Usage
// group is organisation-level except My usage, so non-global callers keep only
// My usage there; every Management item and Settings follows its server-
// resolved flag, and a group with no item is not rendered (Access Control -
// Navigation and landing by role; Design System - Navigation (Sidebar)).
export function navGroupsFor(scope: NavScope): readonly NavGroup[] {
  const management = scope.management;
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (group.label === USAGE_GROUP_LABEL) {
        return scope.global || item.href === MY_USAGE_HREF;
      }
      const flag = MANAGEMENT_FLAG_BY_HREF[item.href];
      return flag !== undefined && management?.[flag] === true;
    }),
  })).filter((group) => group.items.length > 0);
}

export function landingPathFor(scope: NavScope): string {
  return scope.global ? "/dashboard" : "/dashboard/me";
}
