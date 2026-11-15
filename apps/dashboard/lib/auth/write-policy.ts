import { INTERNAL_ADMIN_ROLE } from "./roles";
import type { GlobalRole } from "./roles";

// Source: docs/specs/2026-11-10-access-control.md - "Permission matrix",
// "Roles" (team-scope admin grants never on themselves), "Mover" (authority
// over both teams), "Enforcement" items 1-2 (403 for an unauthorised write; the
// same 404 for a missing and an out-of-scope target). The write side of the
// policy module; pure (no env, IO or server-only).

export type WriteActor = {
  oid: string;
  roles: readonly GlobalRole[];
  teamScopes: ReadonlySet<string>;
  departmentScopes: ReadonlySet<string>;
};

export type TeamRef = { teamId: string; departmentId: string };

export type MatrixOperation =
  | "member"
  | "move"
  | "team-admin"
  | "department-admin"
  | "team-visibility"
  | "department-visibility";

export type MatrixTarget =
  | {
      operation: "member" | "team-admin" | "team-visibility";
      team: TeamRef | null;
      // The person whose scope is granted or removed (team-admin only).
      subjectOid?: string;
    }
  | {
      operation: "department-admin" | "department-visibility";
      departmentId: string | null;
    }
  | { operation: "move"; from: TeamRef | null; to: TeamRef | null };

// forbidden: never allowed for this actor (403). out-of-scope: the target is
// outside the actor's scopes, or not found for a scoped actor (the same 404).
// missing: an actor who holds the permission everywhere named a target that
// does not exist (404, no denied record).
export type WriteVerdict = "allow" | "forbidden" | "out-of-scope" | "missing";

const ORG_ADMIN_ROLE: GlobalRole = "internal-org-admin";
const AUDITOR_ROLE: GlobalRole = "internal-auditor";

// internal-admin and internal-org-admin may do every matrix write anywhere.
export function isMatrixWriter(roles: readonly GlobalRole[]): boolean {
  return roles.includes(INTERNAL_ADMIN_ROLE) || roles.includes(ORG_ADMIN_ROLE);
}

const hasAnyScope = (actor: WriteActor) =>
  actor.teamScopes.size > 0 || actor.departmentScopes.size > 0;

// Whether the actor holds the permission for the operation at all, whatever
// the target. Decided before the request is parsed.
export function mayAttempt(
  actor: WriteActor,
  operation: MatrixOperation,
): boolean {
  if (isMatrixWriter(actor.roles)) return true;
  switch (operation) {
    case "member":
    case "team-admin":
    case "team-visibility":
      return hasAnyScope(actor);
    case "move":
    case "department-visibility":
      return actor.departmentScopes.size > 0;
    case "department-admin":
      return false;
  }
}

const teamInScope = (actor: WriteActor, team: TeamRef) =>
  actor.teamScopes.has(team.teamId) ||
  actor.departmentScopes.has(team.departmentId);

export function decideWrite(
  actor: WriteActor,
  target: MatrixTarget,
): WriteVerdict {
  if (!mayAttempt(actor, target.operation)) return "forbidden";
  const global = isMatrixWriter(actor.roles);

  switch (target.operation) {
    case "move": {
      const { from, to } = target;
      if (from === null || to === null) {
        return global ? "missing" : "out-of-scope";
      }
      if (global) return "allow";
      return actor.departmentScopes.has(from.departmentId) &&
        actor.departmentScopes.has(to.departmentId)
        ? "allow"
        : "out-of-scope";
    }
    case "department-admin":
    case "department-visibility": {
      if (target.departmentId === null) {
        return global ? "missing" : "out-of-scope";
      }
      if (global) return "allow";
      return target.operation === "department-visibility" &&
        actor.departmentScopes.has(target.departmentId)
        ? "allow"
        : "out-of-scope";
    }
    case "team-admin":
    case "member":
    case "team-visibility": {
      if (target.team === null) return global ? "missing" : "out-of-scope";
      if (global) return "allow";
      if (!teamInScope(actor, target.team)) return "out-of-scope";
      // Never their own scope, grant or remove, when the authority comes from
      // the team scope alone.
      return target.operation === "team-admin" &&
        target.subjectOid === actor.oid &&
        !actor.departmentScopes.has(target.team.departmentId)
        ? "forbidden"
        : "allow";
    }
  }
}

export type ReadTarget =
  | { team: TeamRef | null }
  | { departmentId: string | null };

// Management reads (members, admins, visibility): every global reader, or a
// holder of the team or department scope. A missing and an out-of-scope target
// are the same answer to the caller.
export function canManageRead(actor: WriteActor, target: ReadTarget): boolean {
  const global =
    isMatrixWriter(actor.roles) || actor.roles.includes(AUDITOR_ROLE);
  if ("team" in target) {
    if (target.team === null) return false;
    return global || teamInScope(actor, target.team);
  }
  if (target.departmentId === null) return false;
  return global || actor.departmentScopes.has(target.departmentId);
}
