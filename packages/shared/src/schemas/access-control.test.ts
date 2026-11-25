import { describe, expect, it } from "vitest";

import {
  AUDIT_ACTIONS,
  AcceptInviteBodySchema,
  AccessSourceSchema,
  AdminScopeSchema,
  AuditActionSchema,
  AuditItemSchema,
  AuditRecordSchema,
  DEFAULT_DEPARTMENT_VISIBILITY,
  DEFAULT_TEAM_VISIBILITY,
  DepartmentVisibilitySchema,
  GrantableRoleSchema,
  IdentityDetailSchema,
  IdentityLinkSchema,
  InviteCandidateSchema,
  LocalUserSchema,
  MemberAffiliationSchema,
  PendingItemSchema,
  RoleGrantSchema,
  ScopeTypeSchema,
  TeamVisibilitySchema,
  UsageKeyClaimSchema,
  auditCategory,
  isAdminScopeSuspended,
  sanitizeAuditSnapshot,
} from "./access-control";

// Source: docs/specs/2026-11-10-access-control.md — "Data model additions",
// "Audit log", "Visibility and inheritance", threats T4, T7, T17, T18.
// Contract R2 §2-§3. Placeholder ids only (Rule 50.9).
const OID = "00000000-0000-4000-8000-000000000001";
const AT = "2026-11-12T01:02:03.000Z";

const affiliation = {
  oid: OID,
  teamId: "t1",
  source: "ui",
  version: 1,
  createdAt: AT,
  updatedAt: AT,
  createdBy: OID,
};
const adminScope = {
  oid: OID,
  scopeType: "team",
  scopeId: "t1",
  source: "sso",
  version: 1,
  createdAt: AT,
  createdBy: "system",
};
const roleGrant = {
  oid: OID,
  role: "internal-admin",
  reason: "break-glass cover",
  grantedBy: OID,
  grantedAt: AT,
  version: 1,
};
const auditRecord = {
  actor: OID,
  action: "affiliation.add",
  category: "change",
  target: { type: "team", id: "t1" },
  result: "success",
  timestamp: AT,
  requestId: "req-1",
};

const rejects =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (value: unknown) =>
    expect(schema.safeParse(value).success).toBe(false);
const accepts =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (value: unknown) =>
    expect(schema.safeParse(value).success).toBe(true);

describe("enums", () => {
  it("AccessSourceSchema is sso | ui", () => {
    expect(AccessSourceSchema.options).toEqual(["sso", "ui"]);
  });
  it("ScopeTypeSchema is team | department", () => {
    expect(ScopeTypeSchema.options).toEqual(["team", "department"]);
  });
  it("GrantableRoleSchema grants only the two admin roles (T4)", () => {
    expect(GrantableRoleSchema.options).toEqual([
      "internal-admin",
      "internal-org-admin",
    ]);
    rejects(GrantableRoleSchema)("internal-viewer");
    rejects(GrantableRoleSchema)("internal-team-admin");
  });
});

describe("MemberAffiliationSchema", () => {
  it("accepts a valid affiliation", () =>
    accepts(MemberAffiliationSchema)(affiliation));
  it.each([
    ["empty teamId", { teamId: "" }],
    ["unknown source", { source: "scim" }],
    ["negative version", { version: -1 }],
    ["bad createdAt", { createdAt: "yesterday" }],
    ["missing oid", { oid: undefined }],
  ])("rejects %s", (_n, patch) =>
    rejects(MemberAffiliationSchema)({ ...affiliation, ...patch }),
  );
});

describe("AdminScopeSchema", () => {
  it("accepts team and department scopes", () => {
    accepts(AdminScopeSchema)(adminScope);
    accepts(AdminScopeSchema)({ ...adminScope, scopeType: "department" });
  });
  it.each([
    ["bad scopeType", { scopeType: "org" }],
    ["empty scopeId", { scopeId: "" }],
    ["bad source", { source: "x" }],
  ])("rejects %s", (_n, patch) =>
    rejects(AdminScopeSchema)({ ...adminScope, ...patch }),
  );
});

describe("PendingItemSchema", () => {
  const base = {
    emailOrUpn: "jane@example.com",
    createdBy: OID,
    createdAt: AT,
    version: 1,
  };
  it("accepts a pending affiliation and a pending admin scope", () => {
    accepts(PendingItemSchema)({ ...base, kind: "affiliation", teamId: "t1" });
    accepts(PendingItemSchema)({
      ...base,
      kind: "adminScope",
      scopeType: "department",
      scopeId: "d1",
    });
  });
  it("rejects a kind without its fields and unknown kinds", () => {
    rejects(PendingItemSchema)({ ...base, kind: "affiliation" });
    rejects(PendingItemSchema)({ ...base, kind: "adminScope", scopeId: "d1" });
    rejects(PendingItemSchema)({ ...base, kind: "role", teamId: "t1" });
    rejects(PendingItemSchema)({ ...base, kind: "affiliation", teamId: "" });
  });
});

// Access Control spec - "Accept a pending invite (unit INV1)" (body `{ oid,
// reason }` strict, reason 1-280; candidate rows are oid, display name, UPN and
// email only), T-INV1 (no free-text target in the body).
describe("AcceptInviteBodySchema", () => {
  const valid = { oid: OID, reason: "Confirmed by phone" };
  it("accepts { oid, reason } with a reason of 1 to 280 characters", () => {
    accepts(AcceptInviteBodySchema)(valid);
    accepts(AcceptInviteBodySchema)({ ...valid, reason: "r" });
    accepts(AcceptInviteBodySchema)({ ...valid, reason: "r".repeat(280) });
  });
  it.each([
    ["an extra key", { ...valid, teamId: "t1" }],
    ["a free-text target", { emailOrUpn: "jane@example.com", reason: "x" }],
    ["a missing reason", { oid: OID }],
    ["an empty reason", { ...valid, reason: "" }],
    ["a blank reason", { ...valid, reason: "   " }],
    ["a reason over 280 characters", { ...valid, reason: "r".repeat(281) }],
    ["a missing oid", { reason: "x" }],
    ["an empty oid", { ...valid, oid: "" }],
    ["a non-string oid", { ...valid, oid: 7 }],
  ])("rejects %s", (_name, value) => rejects(AcceptInviteBodySchema)(value));
});

describe("InviteCandidateSchema", () => {
  const row = {
    oid: OID,
    displayName: "Jane Doe",
    upn: "jane.doe@company.com",
    email: "jane@example.com",
    exact: false,
    signal: "email",
  };
  it("accepts a row, with displayName, upn or email null when unknown", () => {
    accepts(InviteCandidateSchema)(row);
    accepts(InviteCandidateSchema)({ ...row, email: null });
    accepts(InviteCandidateSchema)({ ...row, displayName: null, upn: null });
  });
  // Access Control - "Placing a person by hand" and "API routes" (candidates
  // row): each row carries `exact` and `signal`; the signal is one of upn,
  // guest-upn, email, litellm-link, or null for a directory-search row (agent
  // decision, to be recorded in the spec).
  it.each(["upn", "guest-upn", "email", "litellm-link", null])(
    "accepts the signal %s",
    (signal) =>
      accepts(InviteCandidateSchema)({
        ...row,
        exact: signal !== null,
        signal,
      }),
  );
  it.each([
    [
      "a missing exact",
      { oid: OID, displayName: null, upn: null, email: null, signal: "upn" },
    ],
    [
      "a missing signal",
      { oid: OID, displayName: null, upn: null, email: null, exact: true },
    ],
    ["a non-boolean exact", { ...row, exact: "yes" }],
    ["an unknown signal", { ...row, signal: "linkedin" }],
    [
      "a LiteLLM user id on the row (threat R1)",
      { ...row, litellmUserId: "u-1" },
    ],
  ])("rejects %s", (_name, value) => rejects(InviteCandidateSchema)(value));
  it.each([
    ["an extra field (nothing else leaves the route)", { ...row, tid: "t" }],
    ["lockout state", { ...row, failedAttempts: 1 }],
    ["a missing oid", { displayName: null, upn: null, email: null }],
    ["an empty oid", { ...row, oid: "" }],
    [
      "an undefined email",
      {
        oid: OID,
        displayName: "J",
        upn: "j@c.com",
        exact: false,
        signal: null,
      },
    ],
  ])("rejects %s", (_name, value) => rejects(InviteCandidateSchema)(value));
});

describe("RoleGrantSchema", () => {
  it("accepts a grant", () => accepts(RoleGrantSchema)(roleGrant));
  it.each([
    ["non-grantable role", { role: "internal-viewer" }],
    ["empty reason", { reason: "" }],
    ["bad grantedAt", { grantedAt: "x" }],
  ])("rejects %s", (_n, patch) =>
    rejects(RoleGrantSchema)({ ...roleGrant, ...patch }),
  );
});

describe("visibility", () => {
  const team = {
    teamId: "t1",
    teamLevel: "visible",
    userLevel: "own",
    version: 1,
    updatedAt: AT,
  };
  const dept = {
    departmentId: "d1",
    departmentLevel: "hidden",
    maxUserLevel: "own",
    version: 1,
    updatedAt: AT,
  };
  it("accepts valid team and department visibility", () => {
    accepts(TeamVisibilitySchema)(team);
    accepts(DepartmentVisibilitySchema)(dept);
  });
  it("rejects out-of-range levels", () => {
    rejects(TeamVisibilitySchema)({ ...team, teamLevel: "own" });
    rejects(TeamVisibilitySchema)({ ...team, userLevel: "visible" });
    rejects(DepartmentVisibilitySchema)({ ...dept, departmentLevel: "all" });
    rejects(DepartmentVisibilitySchema)({ ...dept, maxUserLevel: "hidden" });
  });
  it("has least-privilege defaults (spec table)", () => {
    expect(DEFAULT_TEAM_VISIBILITY).toEqual({
      teamLevel: "visible",
      userLevel: "own",
    });
    expect(DEFAULT_DEPARTMENT_VISIBILITY).toEqual({
      departmentLevel: "hidden",
      maxUserLevel: "own",
    });
  });
});

describe("LocalUserSchema", () => {
  const user = {
    email: "dev@example.com",
    oid: "local:dev@example.com",
    tid: "local",
    roles: ["internal-admin"],
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  };
  it("accepts a local user with or without displayName", () => {
    accepts(LocalUserSchema)(user);
    accepts(LocalUserSchema)({ ...user, displayName: "Dev" });
  });
  it.each([
    ["no roles", { roles: [] }],
    ["unknown role", { roles: ["root"] }],
    ["bad email", { email: "not-an-email" }],
  ])("rejects %s", (_n, patch) =>
    rejects(LocalUserSchema)({ ...user, ...patch }),
  );
});

describe("IdentityLinkSchema", () => {
  const link = {
    oid: OID,
    usageIdentities: ["jane@example.com"],
    aliases: ["jdoe@example.com"],
    version: 1,
    updatedAt: AT,
  };
  it("accepts a link, with or without litellmUserId", () => {
    accepts(IdentityLinkSchema)(link);
    accepts(IdentityLinkSchema)({ ...link, litellmUserId: "u-1" });
  });
  it("rejects a key in both lists", () => {
    rejects(IdentityLinkSchema)({ ...link, aliases: ["jane@example.com"] });
  });
  it("rejects duplicates within a list", () => {
    rejects(IdentityLinkSchema)({
      ...link,
      usageIdentities: ["a@example.com", "a@example.com"],
    });
    rejects(IdentityLinkSchema)({ ...link, aliases: ["b", "b"] });
  });
});

describe("UsageKeyClaimSchema", () => {
  it("accepts a claim and rejects empty fields", () => {
    accepts(UsageKeyClaimSchema)({ key: "jane@example.com", oid: OID });
    rejects(UsageKeyClaimSchema)({ key: "", oid: OID });
    rejects(UsageKeyClaimSchema)({ key: "jane@example.com" });
  });
});

describe("audit schemas", () => {
  it("lists every audited action", () => {
    // LD15: viewing the LiteLLM audit is itself audited; D27 adds the mapping-rules action;
    // LD24/LT22 add the denied-only connection-test action.
    // L4 slice 1 adds the eight member-write actions (LiteLLM spec - Writes).
    // L4 slices 2 and 3 add six key actions and four team actions.
    // L6 adds litellm.gateway.update (LiteLLM spec - Combined usage, Gateway configuration).
    // M4 adds the three budgetreset.request.* actions; M3 adds identity.litellm-link.set / .remove and litellm.user.create (Access Control - Budget reset requests, LiteLLM user links, Audit log).
    // M2 adds appteam.create (Access Control - Created app teams); INV1 adds
    // affiliation.invite.accept (Access Control - Audit log, Covered).
    // RS2 adds litellm.user.reset-spend (Access Control - Audit log; LiteLLM spec LD39).
    // SYNC1 adds litellm.user.sync, identity.litellm-pending.set and
    // identity.litellm-pending.remove (Access Control - Audit log, Covered).
    expect(AUDIT_ACTIONS).toHaveLength(78);
    for (const action of [
      "litellm.user.sync",
      "identity.litellm-pending.set",
      "identity.litellm-pending.remove",
    ]) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
    expect(AUDIT_ACTIONS).toContain("litellm.user.reset-spend");
    expect(AUDIT_ACTIONS).toContain("affiliation.invite.accept");
    for (const action of [
      "appteam.create",
      "budgetreset.request.create",
      "budgetreset.request.approve",
      "budgetreset.request.deny",
      "identity.litellm-link.set",
      "identity.litellm-link.remove",
      "litellm.user.create",
    ]) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
    for (const op of [
      "add",
      "remove",
      "budget",
      "limits",
      "reset-spend",
      "reset-budget",
      "disable",
      "enable",
    ]) {
      expect(AUDIT_ACTIONS).toContain(`litellm.member.${op}`);
    }
    for (const op of [
      "generate",
      "update",
      "block",
      "unblock",
      "delete",
      "rotate",
    ]) {
      expect(AUDIT_ACTIONS).toContain(`litellm.key.${op}`);
    }
    for (const op of ["create", "budget", "limits", "models"]) {
      expect(AUDIT_ACTIONS).toContain(`litellm.team.${op}`);
    }
    expect(AUDIT_ACTIONS).toContain("litellm.connection.test");
    expect(AUDIT_ACTIONS).toContain("litellm.audit.view");
    expect(AUDIT_ACTIONS).toContain("auth.signin.success");
    expect(AUDIT_ACTIONS).toContain("auth.signout");
    expect(AUDIT_ACTIONS).toContain("affiliation.move");
    expect(AUDIT_ACTIONS).toContain("accessreview.export");
    expect(AUDIT_ACTIONS).toContain("litellm.gateway.update");
    expect(AUDIT_ACTIONS).toContain("litellm.toggles.update");
    expect(AUDIT_ACTIONS).toContain("litellm.toggles.reset");
    expect(AUDIT_ACTIONS).toContain("litellm.teamlink.link");
    expect(AUDIT_ACTIONS).toContain("litellm.teamlink.unlink");
    expect(AUDIT_ACTIONS).toContain("identity.map.update");
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });
  it("AuditActionSchema accepts known and rejects unknown actions", () => {
    accepts(AuditActionSchema)("role.grant");
    rejects(AuditActionSchema)("role.nuke");
  });
  it("AuditRecordSchema accepts a record, optional fields included", () => {
    accepts(AuditRecordSchema)(auditRecord);
    accepts(AuditRecordSchema)({
      ...auditRecord,
      teamId: "t1",
      before: { teamId: "t1" },
      after: { teamId: "t2" },
    });
    accepts(AuditRecordSchema)({ ...auditRecord, actor: "system" });
  });
  it.each([
    ["bad result", { result: "ok" }],
    ["bad category", { category: "audit" }],
    ["bad timestamp", { timestamp: "now" }],
    ["unknown action", { action: "x.y" }],
    ["missing requestId", { requestId: undefined }],
  ])("AuditRecordSchema rejects %s", (_n, patch) =>
    rejects(AuditRecordSchema)({ ...auditRecord, ...patch }),
  );
  it("AuditRecordSchema accepts result denied, with or without target (D17)", () => {
    const noTarget = { ...auditRecord, target: undefined };
    const denied = {
      category: "security",
      result: "denied",
      code: "FORBIDDEN",
    };
    accepts(AuditRecordSchema)({ ...auditRecord, ...denied });
    accepts(AuditRecordSchema)({ ...noTarget, ...denied });
  });
  it.each(["FORBIDDEN", "NOT_FOUND", "PRIVILEGED_TARGET"])(
    "AuditRecordSchema accepts a denied record with code %s and a route",
    (code) =>
      accepts(AuditRecordSchema)({
        ...auditRecord,
        category: "security",
        result: "denied",
        code,
        route: { method: "POST", pattern: "/api/accounts" },
      }),
  );
  it("AuditRecordSchema rejects a denied record without code, or with an unknown code", () => {
    const denied = { ...auditRecord, category: "security", result: "denied" };
    rejects(AuditRecordSchema)(denied);
    rejects(AuditRecordSchema)({ ...denied, code: "OPERATION_DISABLED" });
    rejects(AuditRecordSchema)({ ...denied, code: undefined });
  });
  it("AuditRecordSchema rejects a malformed route", () => {
    const denied = {
      ...auditRecord,
      category: "security",
      result: "denied",
      code: "FORBIDDEN",
    };
    rejects(AuditRecordSchema)({ ...denied, route: { method: "POST" } });
  });
  it.each(["success", "failed"])(
    "AuditRecordSchema requires target when result is %s",
    (result) => {
      const noTarget = { ...auditRecord, target: undefined };
      rejects(AuditRecordSchema)({ ...noTarget, result });
    },
  );
  it("AuditItemSchema adds PK, SK and expiresAt", () => {
    const item = {
      ...auditRecord,
      PK: "AUDIT#2026-11-12",
      SK: `${AT}#req-1#00`,
      expiresAt: 1_800_000_000,
    };
    accepts(AuditItemSchema)(item);
    rejects(AuditItemSchema)({ ...item, expiresAt: undefined });
    rejects(AuditItemSchema)({ ...item, PK: undefined });
  });
});

describe("auditCategory", () => {
  it.each([
    "auth.master.signin",
    "auth.master.failure",
    "auth.master.lockout",
    "auth.signin.error",
    "role.grant",
    "role.revoke",
  ] as const)("%s is security", (action) =>
    expect(auditCategory(action)).toBe("security"),
  );
  it("every denied record is security, whatever the action (D17)", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(auditCategory(action, "denied")).toBe("security");
    }
  });
  it("success and failed results keep the action's own category", () => {
    expect(auditCategory("affiliation.add", "success")).toBe("change");
    expect(auditCategory("role.grant", "failed")).toBe("security");
  });
  it("sign-in and sign-out are change events, not security events (D18)", () => {
    expect(auditCategory("auth.signin.success")).toBe("change");
    expect(auditCategory("auth.signout")).toBe("change");
    accepts(AuditActionSchema)("auth.signin.success");
    accepts(AuditActionSchema)("auth.signout");
  });
  it("every other action is change", () => {
    const security = new Set([
      "auth.master.signin",
      "auth.master.failure",
      "auth.master.lockout",
      "auth.signin.error",
      "role.grant",
      "role.revoke",
    ]);
    for (const action of AUDIT_ACTIONS) {
      if (!security.has(action)) expect(auditCategory(action)).toBe("change");
    }
  });
});

describe("sanitizeAuditSnapshot (T17)", () => {
  it("keeps allowlisted scalars", () => {
    expect(
      sanitizeAuditSnapshot({ teamId: "t1", source: "ui", version: 2 }),
    ).toMatchObject({ teamId: "t1", source: "ui" });
  });
  // LiteLLM spec - Writes (key and team audit "sanitised fields"), L4 slices 2-3.
  it("keeps the LiteLLM key and team setting fields, but never a key value (LT9)", () => {
    const fields = {
      keyAlias: "ci",
      models: ["claude-sonnet"],
      maxBudget: 10,
      budgetDuration: "30d",
      softBudget: 8,
      maxParallelRequests: 2,
      duration: "30d",
      modelRpmLimit: ["claude-sonnet=20"],
      modelTpmLimit: ["claude-sonnet=2000"],
      teamMemberRpmLimit: 10,
      teamMemberTpmLimit: 1000,
      teamAlias: "Alpha",
      tokenIds: ["a".repeat(64)],
    };
    expect(sanitizeAuditSnapshot({ ...fields, key: "sk-secret" })).toEqual(
      fields,
    );
  });
  // LiteLLM spec - Gateway configuration: the audit record holds the lists
  // before and after as string lists ("<type>:<value>", account ids).
  it("keeps the gateway principal and account lists (litellm.gateway.update)", () => {
    const lists = {
      version: 2,
      principals: ["iam-role:litellm-bedrock", "usage-key:svc-gateway"],
      accountIds: ["123456789012"],
    };
    expect(sanitizeAuditSnapshot(lists)).toEqual(lists);
  });
  // Access Control - LiteLLM user sync, Records: every record of a run carries
  // its runId; the summary carries trigger, truncated, plan hash and skipped;
  // a link's record carries the matched key. T17: only listed keys survive;
  // T-SY1: sso_user_id is never stored.
  it("keeps the sync record fields and drops sso_user_id", () => {
    const fields = {
      runId: "run-1",
      trigger: "schedule",
      truncated: false,
      planHash: "a".repeat(64),
      skipped: "locked",
      matchedKey: "oid",
      litellmUserId: "lu-1",
      mode: "sync",
    };
    expect(
      sanitizeAuditSnapshot({ ...fields, sso_user_id: "entra-1" }),
    ).toEqual(fields);
  });
  // Access Control - LiteLLM user links (agent decision, 2026-11-18, unit M3): the record carries mode, both ids and the reason (T17, T-MI1).
  it("keeps the LiteLLM link mode, both ids and the reason", () => {
    const link = {
      oid: "o1",
      litellmUserId: "lu-1",
      mode: "manual",
      reason: "Same person, other email",
      version: 2,
    };
    expect(sanitizeAuditSnapshot({ ...link, key: "sk-secret" })).toEqual(link);
  });
  it("drops secrets and claim-like keys", () => {
    const out = sanitizeAuditSnapshot({
      teamId: "t1",
      password: "hunter2",
      totpSecret: "JBSWY3DP",
      passwordHash: "$argon2id$x",
      token: "abc",
      claims: { sub: "x" },
      groups: ["g1"],
    });
    const text = JSON.stringify(out);
    for (const key of [
      "password",
      "totpSecret",
      "passwordHash",
      "token",
      "claims",
      "groups",
      "hunter2",
      "JBSWY3DP",
      "argon2id",
    ]) {
      expect(text).not.toContain(key);
    }
    expect(out).toMatchObject({ teamId: "t1" });
  });
  it("drops nested objects other than {type,id}", () => {
    const out = sanitizeAuditSnapshot({
      teamId: "t1",
      removedAdminScope: { type: "team", id: "t1" },
      nested: { a: 1 },
      extra: { type: "team", id: "t1", secret: "x" },
    });
    expect(out).toMatchObject({
      removedAdminScope: { type: "team", id: "t1" },
    });
    expect(out).not.toHaveProperty("nested");
    expect(JSON.stringify(out)).not.toContain("secret");
  });
  it.each([undefined, null, "text", 42])("returns undefined for %j", (value) =>
    expect(sanitizeAuditSnapshot(value)).toBeUndefined(),
  );
});

describe("isAdminScopeSuspended", () => {
  const scope = (source: "sso" | "ui") =>
    AdminScopeSchema.parse({ ...adminScope, source });
  it("suspends an SSO scope while groupsOverage is true", () => {
    expect(isAdminScopeSuspended(scope("sso"), { groupsOverage: true })).toBe(
      true,
    );
  });
  it("never suspends a UI scope", () => {
    expect(isAdminScopeSuspended(scope("ui"), { groupsOverage: true })).toBe(
      false,
    );
  });
  it("does not suspend when the flag is false or absent", () => {
    expect(isAdminScopeSuspended(scope("sso"), { groupsOverage: false })).toBe(
      false,
    );
    expect(isAdminScopeSuspended(scope("sso"), {})).toBe(false);
  });
});

// Access Control - "Placing a person by hand" (user page: `state` signed-in or
// invited for member writers, and `invites: [{ teamId, key }, ...]` when invited
// (one per pending member invite; review W4 of unit INV2);
// absent, not null, for readers), T-IV5. US2's fields are unchanged.
describe("IdentityDetailSchema (state and invites)", () => {
  const detail = {
    oid: OID,
    displayName: "Carol",
    email: "carol@company.com",
    upn: null,
    authMethod: "entra",
    createdAt: AT,
    lastSignInAt: AT,
    memberTeamId: null,
    memberVersion: 0,
    leadScopes: [],
    litellm: { state: "none" },
    linkVersion: 0,
    allowed: {
      editDisplayName: false,
      linkLiteLLM: false,
      unlinkLiteLLM: false,
      resetSpend: false,
      changeMembership: false,
      changeLead: false,
      editRoles: false,
      editUsageIdentities: false,
    },
  };
  const invites = [
    { teamId: "team-b", key: "carol@company.com" },
    { teamId: "team-c", key: "carol@corp.example.com" },
  ];
  it("accepts a person without state or invites, and keeps both when present", () => {
    accepts(IdentityDetailSchema)(detail);
    expect(IdentityDetailSchema.parse(detail)).not.toHaveProperty("state");
    expect(IdentityDetailSchema.parse(detail)).not.toHaveProperty("invites");
    expect(
      IdentityDetailSchema.parse({ ...detail, state: "signed-in" }),
    ).toMatchObject({ state: "signed-in" });
    expect(
      IdentityDetailSchema.parse({ ...detail, state: "invited", invites }),
    ).toMatchObject({ state: "invited", invites });
  });
  it.each([
    ["an unknown state", { ...detail, state: "unknown" }],
    ["a null state (absent, not null)", { ...detail, state: null }],
    ["an invite without a key", { ...detail, invites: [{ teamId: "team-b" }] }],
    ["a single object instead of a list", { ...detail, invites: invites[0] }],
    ["a null invites (absent, not null)", { ...detail, invites: null }],
  ])("rejects %s", (_name, value) => rejects(IdentityDetailSchema)(value));
});

// Design System - "Users, round 3 (unit UP1)", T-UP5; Access Control - row
// /api/identities/[oid]: litellm.state may be `match` with the matched LiteLLM
// email and user id.
describe("IdentityDetailSchema (litellm match, unit UP1)", () => {
  const base = {
    oid: OID,
    displayName: "Bob",
    email: "bob@company.com",
    upn: null,
    authMethod: "entra",
    createdAt: AT,
    lastSignInAt: AT,
    memberTeamId: null,
    memberVersion: 0,
    leadScopes: [],
    linkVersion: 0,
    allowed: {
      editDisplayName: false,
      linkLiteLLM: true,
      unlinkLiteLLM: true,
      resetSpend: false,
      changeMembership: false,
      changeLead: false,
      editRoles: false,
      editUsageIdentities: false,
    },
  };
  it("accepts a match with the LiteLLM user id and email", () => {
    const value = {
      ...base,
      litellm: {
        state: "match",
        litellmUserId: "lu-bob",
        email: "bob@company.com",
      },
    };
    accepts(IdentityDetailSchema)(value);
    expect(IdentityDetailSchema.parse(value).litellm).toEqual(value.litellm);
  });
  it.each([
    ["a match without the email", { state: "match", litellmUserId: "lu-bob" }],
    ["a match without the user id", { state: "match", email: "b@c.com" }],
  ])("rejects %s", (_name, litellm) =>
    rejects(IdentityDetailSchema)({ ...base, litellm }),
  );
});
