import {
  PROBE_DEPARTMENT,
  PROBE_TEAM,
} from "../../test/fixtures/role-probe-seed";

// Add any page a role-probe spec visits (role-landing.spec.ts,
// settings-tabs.spec.ts): the warm-up (support/warm-up.ts) compiles each one
// before the first test, as the probe's r5-admin. Pages a role gets a 404 for
// are listed too: a 404 compiles its route.
const GUILD_ID = "appteam-00000000-0000-4000-8000-000000000001";

export const PROBE_PAGES = [
  "/dashboard",
  "/dashboard/me",
  "/dashboard/team-usage",
  `/dashboard/team-usage?team=${PROBE_TEAM}`,
  `/dashboard/team-usage?team=${GUILD_ID}`,
  "/dashboard/ranking",
  "/dashboard/departments",
  `/dashboard/departments/${PROBE_DEPARTMENT}`,
  "/dashboard/teams",
  `/dashboard/teams/${PROBE_TEAM}`,
  "/dashboard/services",
  "/dashboard/users",
  "/dashboard/manage/team",
  `/dashboard/manage/team/${PROBE_TEAM}`,
  `/dashboard/manage/team/${GUILD_ID}`,
  "/dashboard/manage/litellm",
  "/dashboard/manage/users",
  "/dashboard/manage/audit",
  "/dashboard/litellm?tab=team",
  "/dashboard/litellm?tab=audit",
  "/dashboard/settings",
  "/dashboard/settings/audit",
  "/dashboard/settings/does-not-exist",
  "/dashboard/settings/accounts",
  "/dashboard/settings/sync",
  "/dashboard/settings/litellm",
  "/dashboard/settings/litellm/connection",
  "/dashboard/settings/litellm/guardrails",
  "/dashboard/settings/litellm/gateway",
  "/dashboard/settings/access",
  "/dashboard/settings/access/people",
  "/dashboard/settings/access/visibility",
  "/dashboard/settings/access/roles",
  "/dashboard/settings/access/identities",
  "/dashboard/settings/access/sign-in",
] as const;
