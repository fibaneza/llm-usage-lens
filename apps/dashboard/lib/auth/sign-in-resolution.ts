import type {
  AdminScope,
  GroupMapping,
  MemberAffiliation,
  PendingItem,
} from "@llm-usage-lens/shared";

// Source: docs/specs/2026-11-10-access-control.md — "Identity, SSO mapping and
// defaults" (resolution cases 1-6, one item per scope key, SSO > UI),
// "Membership" Joiner (bind on the lower-cased UPN only, tenant checked, no
// guest UPNs), threats T2 and T8. Pure: the caller reads the inputs and
// commits the plan in one transaction.
export type ScopeType = "team" | "department";
export type ScopeRef = { scopeType: ScopeType; scopeId: string };
export type SsoFlags = { ambiguousMembership: boolean; groupsOverage: boolean };

export type SignInResolutionInput = {
  oid: string;
  tid: string;
  expectedTid: string;
  email: string | undefined;
  upn: string | undefined;
  groups: readonly string[];
  groupsOverage: boolean;
  mappings: readonly GroupMapping[];
  affiliation: MemberAffiliation | null;
  adminScopes: readonly AdminScope[];
  pending: readonly PendingItem[];
};

export type AffiliationOp =
  | { op: "keep" }
  | { op: "put"; teamId: string; source: "sso" }
  | { op: "put"; teamId: string; source: "ui"; boundFrom: string }
  | { op: "delete" };

export type ScopePut = ScopeRef &
  ({ source: "sso" } | { source: "ui"; boundFrom: string });

export type SignInPlan = {
  affiliation: AffiliationOp;
  scopePuts: ScopePut[];
  scopeDeletes: ScopeRef[];
  pendingDeletes: Array<{
    item: PendingItem;
    reason: "bound" | "discarded";
  }>;
  flags: SsoFlags;
};

const scopeKey = (r: ScopeRef): string => `${r.scopeType}#${r.scopeId}`;

export function resolveSignIn(input: SignInResolutionInput): SignInPlan {
  const groups = new Set(input.groups);
  const mapped = input.mappings.filter((m) => groups.has(m.groupId));
  const memberTeams = [
    ...new Set(
      mapped
        .filter((m) => m.scopedRole === "member" && m.target.type === "team")
        .map((m) => m.target.id),
    ),
  ];
  const adminTargets = new Map<string, ScopeRef>();
  for (const m of mapped) {
    if (m.scopedRole !== "internal-team-admin") continue;
    const ref: ScopeRef = { scopeType: m.target.type, scopeId: m.target.id };
    adminTargets.set(scopeKey(ref), ref);
  }

  const overage = input.groupsOverage;
  const ambiguous = !overage && memberTeams.length > 1;
  const current = input.affiliation;
  const flags: SsoFlags = {
    ambiguousMembership: ambiguous,
    groupsOverage: overage,
  };

  const scopePuts: ScopePut[] = [];
  const scopeDeletes: ScopeRef[] = [];
  if (!overage) {
    for (const ref of adminTargets.values()) {
      const existing = input.adminScopes.find(
        (s) => scopeKey(s) === scopeKey(ref),
      );
      if (existing?.source !== "sso") scopePuts.push({ ...ref, source: "sso" });
    }
    for (const s of input.adminScopes) {
      if (s.source === "sso" && !adminTargets.has(scopeKey(s))) {
        scopeDeletes.push({ scopeType: s.scopeType, scopeId: s.scopeId });
      }
    }
  }

  let affiliation: AffiliationOp;
  const singleTarget = !overage && memberTeams.length === 1;
  const onlyTeam = memberTeams[0];
  if (singleTarget && onlyTeam !== undefined) {
    affiliation =
      current?.source === "sso" && current.teamId === onlyTeam
        ? { op: "keep" }
        : { op: "put", teamId: onlyTeam, source: "sso" };
  } else {
    affiliation = current?.source === "sso" ? { op: "delete" } : { op: "keep" };
  }

  const pendingDeletes: SignInPlan["pendingDeletes"] = [];
  const upn = input.upn?.toLowerCase();
  const bindable =
    input.tid === input.expectedTid &&
    upn !== undefined &&
    upn.length > 0 &&
    !upn.includes("#ext#");
  const mine = bindable
    ? input.pending.filter((p) => p.emailOrUpn.toLowerCase() === upn)
    : [];

  if (bindable) {
    const invites = mine.filter((p) => p.kind === "affiliation");
    // Whatever stays after the SSO decision: a kept or newly put affiliation.
    const staysAffiliated =
      affiliation.op === "put" || (affiliation.op === "keep" && current);
    if (staysAffiliated) {
      for (const item of invites) {
        pendingDeletes.push({ item, reason: "discarded" });
      }
    } else if (!ambiguous) {
      const teams = new Set(
        invites.map((p) => (p.kind === "affiliation" ? p.teamId : "")),
      );
      const only = invites[0];
      if (teams.size === 1 && only?.kind === "affiliation") {
        affiliation = {
          op: "put",
          teamId: only.teamId,
          source: "ui",
          boundFrom: upn,
        };
        for (const item of invites) {
          pendingDeletes.push({ item, reason: "bound" });
        }
      }
    }

    for (const item of mine) {
      if (item.kind !== "adminScope") continue;
      if (overage) continue;
      const ref: ScopeRef = {
        scopeType: item.scopeType,
        scopeId: item.scopeId,
      };
      const key = scopeKey(ref);
      const covered =
        input.adminScopes.some((s) => scopeKey(s) === key) ||
        scopePuts.some((s) => scopeKey(s) === key);
      if (covered) {
        pendingDeletes.push({ item, reason: "discarded" });
      } else {
        scopePuts.push({ ...ref, source: "ui", boundFrom: upn });
        pendingDeletes.push({ item, reason: "bound" });
      }
    }
  }

  return { affiliation, scopePuts, scopeDeletes, pendingDeletes, flags };
}
