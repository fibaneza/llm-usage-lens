import { z } from "zod";

import type { IdentityRecord } from "../identity";
import { Iso8601Schema } from "./primitives";

// Source: docs/specs/2026-11-10-access-control.md — "Data model additions",
// "Audit log"; contract R2 §2-§3.
export const AccessSourceSchema = z.enum(["sso", "ui"]);
export const ScopeTypeSchema = z.enum(["team", "department"]);

const IdSchema = z.string().min(1);
const VersionSchema = z.number().int().min(0);

export const MemberAffiliationSchema = z.object({
  oid: IdSchema,
  teamId: IdSchema,
  source: AccessSourceSchema,
  version: VersionSchema,
  createdAt: Iso8601Schema,
  updatedAt: Iso8601Schema,
  createdBy: IdSchema,
});

export const AdminScopeSchema = z.object({
  oid: IdSchema,
  scopeType: ScopeTypeSchema,
  scopeId: IdSchema,
  source: AccessSourceSchema,
  version: VersionSchema,
  createdAt: Iso8601Schema,
  createdBy: IdSchema,
});

// D37 (docs/specs/2026-11-10-access-control.md): list rows name the person; null when the
// identity is unknown. No other identity field leaves the route.
const PersonNameShape = {
  displayName: z.string().nullable(),
  email: z.string().nullable(),
};
export const MemberRowSchema = MemberAffiliationSchema.extend(PersonNameShape);
export const AdminScopeRowSchema = AdminScopeSchema.extend(PersonNameShape);

// F10: GET /api/access/org-units, the account registry scoped to the caller.
export const OrgUnitsSchema = z.object({
  teams: z.array(
    z.object({ id: IdSchema, name: IdSchema, departmentId: IdSchema }),
  ),
  departments: z.array(z.object({ id: IdSchema, name: IdSchema })),
});

const pendingBase = {
  emailOrUpn: IdSchema,
  createdBy: IdSchema,
  createdAt: Iso8601Schema,
  version: VersionSchema,
};
export const PendingItemSchema = z.discriminatedUnion("kind", [
  z.object({
    ...pendingBase,
    kind: z.literal("affiliation"),
    teamId: IdSchema,
  }),
  z.object({
    ...pendingBase,
    kind: z.literal("adminScope"),
    scopeType: ScopeTypeSchema,
    scopeId: IdSchema,
  }),
]);

// GET /api/access/stale (Access Control spec - Leaver, D2, D34): a pending
// item unbound for more than 30 days (`reason: "pending"`, `subject` the email
// or UPN) or bound access whose person has not signed in for 90 days
// (`reason: "inactive"`, `subject` the oid; names from the identity, D37).
export const StaleAccessRowSchema = z.object({
  reason: z.enum(["pending", "inactive"]),
  kind: z.enum(["affiliation", "adminScope", "roleGrant"]),
  subject: IdSchema,
  displayName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  teamId: IdSchema.optional(),
  scopeType: ScopeTypeSchema.optional(),
  scopeId: IdSchema.optional(),
  role: z.string().min(1).optional(),
  since: Iso8601Schema,
});

// Rule 50.3 keeps role values in lib/auth, but shared schemas need the
// literals too (group-mapping.ts precedent; contract R2 decision 18).
export const GrantableRoleSchema = z.enum([
  "internal-admin",
  "internal-org-admin",
]);

export const RoleGrantSchema = z.object({
  oid: IdSchema,
  role: GrantableRoleSchema,
  reason: z.string().min(1),
  grantedBy: IdSchema,
  grantedAt: Iso8601Schema,
  version: VersionSchema,
});

export const TeamVisibilitySchema = z.object({
  teamId: IdSchema,
  teamLevel: z.enum(["visible", "hidden"]),
  userLevel: z.enum(["all", "own", "none"]),
  version: VersionSchema,
  updatedAt: Iso8601Schema,
});
export const DepartmentVisibilitySchema = z.object({
  departmentId: IdSchema,
  departmentLevel: z.enum(["visible", "hidden"]),
  maxUserLevel: z.enum(["all", "own", "none"]),
  version: VersionSchema,
  updatedAt: Iso8601Schema,
});

export const DEFAULT_TEAM_VISIBILITY: Pick<
  TeamVisibility,
  "teamLevel" | "userLevel"
> = { teamLevel: "visible", userLevel: "own" };
export const DEFAULT_DEPARTMENT_VISIBILITY: Pick<
  DepartmentVisibility,
  "departmentLevel" | "maxUserLevel"
> = { departmentLevel: "hidden", maxUserLevel: "own" };

const GLOBAL_ROLE_VALUES = [
  "internal-admin",
  "internal-org-admin",
  "internal-auditor",
  "internal-viewer",
] as const;

export const LocalUserSchema = z.object({
  email: z.email(),
  oid: IdSchema,
  tid: IdSchema,
  displayName: z.string().optional(),
  roles: z.array(z.enum(GLOBAL_ROLE_VALUES)).min(1),
  version: VersionSchema,
  createdAt: Iso8601Schema,
  updatedAt: Iso8601Schema,
});

export const PasswordUserStatusSchema = z.enum([
  "enabled",
  "disabled",
  "sso-bound",
]);

// Read model of a password user (Access Control spec — Password users): never
// a hash, TOTP secret or setup token.
export const PasswordUserSchema = z.object({
  email: z.email(),
  oid: IdSchema,
  tid: z.literal("local"),
  displayName: z.string().min(1),
  status: PasswordUserStatusSchema,
  version: VersionSchema,
  sso: z.object({
    expectedUpn: z.string().min(1),
    expectedOid: IdSchema.optional(),
    tid: IdSchema.optional(),
    oid: IdSchema.optional(),
    boundAt: Iso8601Schema.optional(),
  }),
  setup: z.object({ expiresAt: Iso8601Schema }).optional(),
  ssoConflict: z.boolean().optional(),
});

export const PasswordUserListStatusSchema = z.enum([
  "enabled",
  "disabled",
  "pending-setup",
  "sso-bound",
]);

// One row of GET /api/password-users (Access Control spec - API routes
// (additions)): never a hash, TOTP secret, setup token or token hash.
export const PasswordUserListItemSchema = z.object({
  email: z.email(),
  displayName: z.string().min(1),
  status: PasswordUserListStatusSchema,
  totpEnrolled: z.boolean(),
  createdAt: Iso8601Schema,
  version: VersionSchema,
});

// POST /api/password-users body; the email is lower-cased on write.
export const PasswordUserInputSchema = z.object({
  email: z.email().max(254),
  displayName: z.string().min(1).max(200),
  sso: z
    .object({
      expectedUpn: z.string().min(1).max(254).optional(),
      expectedOid: IdSchema.max(128).optional(),
    })
    .optional(),
});

export const IdentityLinkSchema = z
  .object({
    oid: IdSchema,
    usageIdentities: z.array(IdSchema),
    aliases: z.array(IdSchema),
    litellmUserId: z.string().min(1).optional(),
    version: VersionSchema,
    updatedAt: Iso8601Schema,
  })
  .refine(
    (v) => {
      const all = [...v.usageIdentities, ...v.aliases];
      return new Set(all).size === all.length;
    },
    { message: "keys must be unique across usageIdentities and aliases" },
  );

export const UsageKeyClaimSchema = z.object({ key: IdSchema, oid: IdSchema });

export const AUDIT_ACTIONS = [
  "auth.master.signin",
  "auth.master.failure",
  "auth.master.lockout",
  "auth.signin.error",
  "role.grant",
  "role.revoke",
  "groupmap.create",
  "groupmap.update",
  "groupmap.delete",
  "affiliation.add",
  "affiliation.remove",
  "affiliation.move",
  "affiliation.bind",
  "affiliation.sso.set",
  "affiliation.sso.remove",
  "adminscope.grant",
  "adminscope.revoke",
  "adminscope.bind",
  "adminscope.sso.add",
  "adminscope.sso.remove",
  "pending.create",
  "pending.delete",
  "pending.discard",
  "visibility.update",
  "identity.link.update",
  "identity.flags.update",
  "localuser.create",
  "localuser.update",
  "localuser.delete",
  "identity.bind.sso",
  "governance.passwordsignin.update",
  "account.create",
  "account.update",
  "account.deactivate",
  "governance.approval.update",
  "identity.map.update",
  "audit.view",
  "accessreview.export",
  "auth.signin.success",
  "auth.signout",
  "litellm.connection.update",
  "litellm.connection.test",
  "litellm.toggles.update",
  "litellm.toggles.reset",
  "litellm.teamlink.link",
  "litellm.teamlink.unlink",
  "litellm.audit.view",
  "litellm.member.add",
  "litellm.member.remove",
  "litellm.member.budget",
  "litellm.member.limits",
  "litellm.member.reset-spend",
  "litellm.member.reset-budget",
  "litellm.member.disable",
  "litellm.member.enable",
  "litellm.key.generate",
  "litellm.key.update",
  "litellm.key.block",
  "litellm.key.unblock",
  "litellm.key.delete",
  "litellm.key.rotate",
  "litellm.team.create",
  "litellm.team.budget",
  "litellm.team.limits",
  "litellm.team.models",
] as const;
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditActionSchema>;

const SnapshotValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.strictObject({ type: z.string(), id: z.string() }),
]);
export const AuditSnapshotSchema = z.record(z.string(), SnapshotValueSchema);
export type AuditSnapshot = z.infer<typeof AuditSnapshotSchema>;

const AuditRecordBaseSchema = z.object({
  actor: IdSchema,
  action: AuditActionSchema,
  category: z.enum(["security", "change"]),
  target: z.object({ type: z.string(), id: z.string() }).optional(),
  teamId: z.string().optional(),
  before: AuditSnapshotSchema.optional(),
  after: AuditSnapshotSchema.optional(),
  result: z.enum(["success", "failed", "denied"]),
  code: z.enum(["FORBIDDEN", "NOT_FOUND", "PRIVILEGED_TARGET"]).optional(),
  route: z.object({ method: z.string(), pattern: z.string() }).optional(),
  timestamp: Iso8601Schema,
  requestId: IdSchema,
});

// A denied attempt omits the target when the caller has no validated id and
// always carries the refusal code (D17).
const auditInvariants = (v: {
  result: string;
  target?: unknown;
  code?: unknown;
}): boolean =>
  v.result === "denied" ? v.code !== undefined : v.target !== undefined;
const INVARIANTS = {
  message:
    "target is required unless the result is denied; code is required when it is",
  path: ["target"],
};

export const AuditRecordSchema = AuditRecordBaseSchema.refine(
  auditInvariants,
  INVARIANTS,
);

export const AuditItemSchema = AuditRecordBaseSchema.extend({
  PK: IdSchema,
  SK: IdSchema,
  expiresAt: z.number().int(),
}).refine(auditInvariants, INVARIANTS);

const SECURITY_ACTIONS: ReadonlySet<AuditAction> = new Set([
  "auth.master.signin",
  "auth.master.failure",
  "auth.master.lockout",
  "auth.signin.error",
  "role.grant",
  "role.revoke",
]);

export function auditCategory(
  action: AuditAction,
  result?: "success" | "failed" | "denied",
): "security" | "change" {
  if (result === "denied") return "security";
  return SECURITY_ACTIONS.has(action) ? "security" : "change";
}

// T17: only these keys may reach a stored before/after snapshot.
const SNAPSHOT_KEYS: ReadonlySet<string> = new Set([
  "oid",
  "teamId",
  "fromTeamId",
  "toTeamId",
  "scopeType",
  "scopeId",
  "source",
  "role",
  "scopedRole",
  "groupId",
  "target",
  "version",
  "teamLevel",
  "userLevel",
  "departmentLevel",
  "maxUserLevel",
  "kind",
  "boundFrom",
  "ambiguousMembership",
  "groupsOverage",
  "removedAdminScope",
  "roles",
  "usageIdentities",
  "aliases",
  "accountId",
  "active",
  "method",
  "baseUrl",
  "litellmTeamId",
  "litellmUserId",
  "maxBudgetInTeam",
  "rpmLimit",
  "tpmLimit",
  "spend",
  "budgetId",
  "tokenIds",
  "keyAlias",
  "models",
  "maxBudget",
  "budgetDuration",
  "softBudget",
  "maxParallelRequests",
  "duration",
  "modelRpmLimit",
  "modelTpmLimit",
  "teamMemberRpmLimit",
  "teamMemberTpmLimit",
  "teamAlias",
  "toggles",
  "rules",
]);

export function sanitizeAuditSnapshot(
  value: unknown,
): AuditSnapshot | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const out: AuditSnapshot = {};
  for (const [key, v] of Object.entries(value)) {
    if (!SNAPSHOT_KEYS.has(key)) continue;
    const parsed = SnapshotValueSchema.safeParse(v);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

// Access Control spec - "Visibility and inheritance" (organisation cap): who,
// when and the works-council / data-protection reference (GOVERNANCE/PER_USER).
export const PerUserApprovalSchema = z.object({
  approvedBy: IdSchema,
  approvedAt: Iso8601Schema,
  reference: z.string().min(1),
  version: VersionSchema,
});

export function isAdminScopeSuspended(
  scope: AdminScope,
  identity: Pick<IdentityRecord, "groupsOverage">,
): boolean {
  return scope.source === "sso" && identity.groupsOverage === true;
}

export type PerUserApproval = z.infer<typeof PerUserApprovalSchema>;
export type AccessSource = z.infer<typeof AccessSourceSchema>;
export type MemberAffiliation = z.infer<typeof MemberAffiliationSchema>;
export type AdminScope = z.infer<typeof AdminScopeSchema>;
export type MemberRow = z.infer<typeof MemberRowSchema>;
export type AdminScopeRow = z.infer<typeof AdminScopeRowSchema>;
export type OrgUnits = z.infer<typeof OrgUnitsSchema>;
export type PendingItem = z.infer<typeof PendingItemSchema>;
export type StaleAccessRow = z.infer<typeof StaleAccessRowSchema>;
export type GrantableRole = z.infer<typeof GrantableRoleSchema>;
export type RoleGrant = z.infer<typeof RoleGrantSchema>;
export type TeamVisibility = z.infer<typeof TeamVisibilitySchema>;
export type DepartmentVisibility = z.infer<typeof DepartmentVisibilitySchema>;
export type PasswordUser = z.infer<typeof PasswordUserSchema>;
export type PasswordUserListItem = z.infer<typeof PasswordUserListItemSchema>;
export type PasswordUserInput = z.infer<typeof PasswordUserInputSchema>;
export type LocalUser = z.infer<typeof LocalUserSchema>;
export type IdentityLink = z.infer<typeof IdentityLinkSchema>;
export type UsageKeyClaim = z.infer<typeof UsageKeyClaimSchema>;
export type AuditRecord = z.infer<typeof AuditRecordSchema>;
