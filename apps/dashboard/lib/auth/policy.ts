import {
  DEFAULT_DEPARTMENT_VISIBILITY,
  DEFAULT_TEAM_VISIBILITY,
  isAdminScopeSuspended,
} from "@llm-usage-lens/shared";
import type {
  AdminScope,
  DepartmentVisibility,
  IdentityLink,
  MemberAffiliation,
  RoleGrant,
  TeamVisibility,
} from "@llm-usage-lens/shared";

import {
  INTERNAL_AUDITOR_ROLE,
  isGlobalRole,
  resolveGlobalRoles,
} from "./roles";
import type { GlobalRole } from "./roles";

// Source: docs/specs/2026-11-10-access-control.md - "Visibility and
// inheritance" (evaluation order, caps), "Membership, admin scopes and
// lifecycle" (department scope per day, W3), "Enforcement" item 1. Pure: no
// env, IO or server-only, so it is unit-testable and importable anywhere.

export type UserLevel = "all" | "own" | "none";

export type PolicySession =
  | {
      user?: {
        oid?: unknown;
        roles?: unknown;
        email?: unknown;
        authMethod?: unknown;
      };
    }
  | null
  | undefined;

export type ResolveScopeInput = {
  appEnv: "dev" | "prod";
  session: PolicySession;
  affiliation: MemberAffiliation | null;
  adminScopes: readonly AdminScope[];
  roleGrants: readonly RoleGrant[];
  identity: { groupsOverage?: boolean | undefined } | null;
  identityLink: IdentityLink | null;
  visibility: {
    teams: ReadonlyMap<string, TeamVisibility>;
    departments: ReadonlyMap<string, DepartmentVisibility>;
  };
  perUserApproved: boolean;
};

export type Scope = {
  authenticated: boolean;
  global: boolean;
  userLevelCap: UserLevel;
  memberTeamId: string | null;
  teamScopes: ReadonlySet<string>;
  departmentScopes: ReadonlySet<string>;
  usageKeys: ReadonlySet<string>;
  visibility: ResolveScopeInput["visibility"];
};

export type Resource =
  | { kind: "team"; teamId: string; departmentId: string; date: string }
  | {
      kind: "department";
      departmentId: string;
      // False when the caller is only a member and their team was not in the
      // department on the day; omitted means "not decided by the caller".
      viaMemberTeam?: boolean;
    }
  | { kind: "user-rows"; teamId: string; departmentId: string }
  | {
      kind: "user-row";
      teamId: string;
      departmentId: string;
      usageKey: string;
    }
  | { kind: "user-counts"; teamId: string; departmentId: string; date: string }
  | { kind: "own-usage" };

const GLOBAL_READER_ROLES: readonly GlobalRole[] = [
  "internal-admin",
  "internal-org-admin",
  INTERNAL_AUDITOR_ROLE,
];

export function globalRolesOf(
  session: PolicySession,
  appEnv: "dev" | "prod",
  grants: readonly Pick<RoleGrant, "role">[],
): GlobalRole[] | null {
  const claim = resolveGlobalRoles(session?.user?.roles, appEnv);
  if (claim === null) return null;
  const roles = new Set<GlobalRole>(claim);
  for (const grant of grants) {
    if (isGlobalRole(grant.role)) roles.add(grant.role);
  }
  return [...roles];
}

export function isGlobalReader(roles: readonly GlobalRole[]): boolean {
  return roles.some((role) => GLOBAL_READER_ROLES.includes(role));
}

export function hasSessionIdentity(session: PolicySession): boolean {
  const oid = session?.user?.oid;
  return typeof oid === "string" && oid !== "";
}

const RANK: Record<UserLevel, number> = { none: 0, own: 1, all: 2 };
const minLevel = (a: UserLevel, b: UserLevel): UserLevel =>
  RANK[a] <= RANK[b] ? a : b;

const UNAUTHENTICATED: Scope = {
  authenticated: false,
  global: false,
  userLevelCap: "none",
  memberTeamId: null,
  teamScopes: new Set(),
  departmentScopes: new Set(),
  usageKeys: new Set(),
  visibility: { teams: new Map(), departments: new Map() },
};

export function resolveScope(input: ResolveScopeInput): Scope {
  if (!hasSessionIdentity(input.session)) return UNAUTHENTICATED;
  const roles = globalRolesOf(input.session, input.appEnv, input.roleGrants);
  if (roles === null) return UNAUTHENTICATED;

  const identity = input.identity ?? {};
  const live = input.adminScopes.filter(
    (scope) => !isAdminScopeSuspended(scope, identity),
  );
  const keys = new Set<string>();
  const email = input.session?.user?.email;
  if (typeof email === "string" && email !== "") keys.add(email.toLowerCase());
  for (const key of [
    ...(input.identityLink?.usageIdentities ?? []),
    ...(input.identityLink?.aliases ?? []),
  ]) {
    keys.add(key.toLowerCase());
  }

  const gated = input.appEnv === "prod" && !input.perUserApproved;
  return {
    authenticated: true,
    global: isGlobalReader(roles),
    userLevelCap: gated ? "own" : "all",
    memberTeamId: input.affiliation?.teamId ?? null,
    teamScopes: new Set(
      live.filter((s) => s.scopeType === "team").map((s) => s.scopeId),
    ),
    departmentScopes: new Set(
      live.filter((s) => s.scopeType === "department").map((s) => s.scopeId),
    ),
    usageKeys: keys,
    visibility: input.visibility,
  };
}

const teamSettings = (scope: Scope, teamId: string) => ({
  ...DEFAULT_TEAM_VISIBILITY,
  ...scope.visibility.teams.get(teamId),
});
const departmentSettings = (scope: Scope, departmentId: string) => ({
  ...DEFAULT_DEPARTMENT_VISIBILITY,
  ...scope.visibility.departments.get(departmentId),
});

function canReadTeam(
  scope: Scope,
  teamId: string,
  departmentId: string,
): boolean {
  if (!scope.authenticated) return false;
  if (scope.global) return true;
  if (scope.teamScopes.has(teamId) || scope.departmentScopes.has(departmentId))
    return true;
  return (
    scope.memberTeamId === teamId &&
    teamSettings(scope, teamId).teamLevel === "visible"
  );
}

function canReadDepartment(
  scope: Scope,
  departmentId: string,
  viaMemberTeam: boolean,
): boolean {
  if (!scope.authenticated) return false;
  if (scope.global || scope.departmentScopes.has(departmentId)) return true;
  return (
    scope.memberTeamId !== null &&
    viaMemberTeam &&
    departmentSettings(scope, departmentId).departmentLevel === "visible"
  );
}

// effective = min(organisation cap, department cap, team setting); a caller
// who cannot read the team has no per-user data from it.
export function effectiveUserLevel(
  scope: Scope,
  ref: { teamId: string; departmentId: string },
): UserLevel {
  if (!canReadTeam(scope, ref.teamId, ref.departmentId)) return "none";
  if (scope.global) return scope.userLevelCap;
  const level = minLevel(
    teamSettings(scope, ref.teamId).userLevel,
    departmentSettings(scope, ref.departmentId).maxUserLevel,
  );
  return minLevel(level, scope.userLevelCap);
}

export function can(scope: Scope, action: "read", resource: Resource): boolean {
  if (action !== "read" || !scope.authenticated) return false;
  switch (resource.kind) {
    case "own-usage":
      return true;
    case "team":
    case "user-counts":
      return canReadTeam(scope, resource.teamId, resource.departmentId);
    case "department":
      return canReadDepartment(
        scope,
        resource.departmentId,
        resource.viaMemberTeam ?? true,
      );
    case "user-rows":
      return effectiveUserLevel(scope, resource) === "all";
    case "user-row": {
      const level = effectiveUserLevel(scope, resource);
      if (level === "all") return true;
      return (
        level === "own" && scope.usageKeys.has(resource.usageKey.toLowerCase())
      );
    }
  }
}
