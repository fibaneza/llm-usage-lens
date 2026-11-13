import { describe, expect, it } from "vitest";

import type {
  AdminScope,
  GroupMapping,
  MemberAffiliation,
  PendingItem,
} from "@llm-usage-lens/shared";

import {
  resolveSignIn,
  type SignInResolutionInput,
} from "@/lib/auth/sign-in-resolution";

// Source: docs/specs/2026-11-10-access-control.md — "Identity, SSO mapping and
// defaults" -> Resolution at every sign-in (cases 1-6), "One item per scope
// key", Precedence; Membership -> Joiner (amended R2: bind on the lower-cased
// UPN only); Threat model T2 and T8. Contract R2 §3 `resolveSignIn`, §1
// decisions 5-10 (decision 10's email matching is superseded: UPN only).
const OID = "00000000-0000-4000-8000-000000000001";
const TID = "00000000-0000-4000-8000-0000000000aa";
const AT = "2026-11-12T01:02:03.000Z";

const memberMap = (groupId: string, teamId: string): GroupMapping => ({
  groupId,
  target: { type: "team", id: teamId },
  scopedRole: "member",
  version: 1,
  updatedAt: AT,
});
const adminMap = (
  groupId: string,
  type: "team" | "department",
  id: string,
): GroupMapping => ({
  groupId,
  target: { type, id },
  scopedRole: "internal-team-admin",
  version: 1,
  updatedAt: AT,
});
const affiliation = (
  teamId: string,
  source: "sso" | "ui",
): MemberAffiliation => ({
  oid: OID,
  teamId,
  source,
  version: 1,
  createdAt: AT,
  updatedAt: AT,
  createdBy: source === "sso" ? "system" : OID,
});
const scope = (
  scopeType: "team" | "department",
  scopeId: string,
  source: "sso" | "ui",
): AdminScope => ({
  oid: OID,
  scopeType,
  scopeId,
  source,
  version: 1,
  createdAt: AT,
  createdBy: source === "sso" ? "system" : OID,
});
const pendingAffiliation = (
  emailOrUpn: string,
  teamId: string,
): PendingItem => ({
  emailOrUpn,
  kind: "affiliation",
  teamId,
  createdBy: OID,
  createdAt: AT,
  version: 1,
});
const pendingScope = (
  emailOrUpn: string,
  scopeType: "team" | "department",
  scopeId: string,
): PendingItem => ({
  emailOrUpn,
  kind: "adminScope",
  scopeType,
  scopeId,
  createdBy: OID,
  createdAt: AT,
  version: 1,
});

const input = (
  patch: Partial<SignInResolutionInput> = {},
): SignInResolutionInput => ({
  oid: OID,
  tid: TID,
  expectedTid: TID,
  email: undefined,
  upn: undefined,
  groups: [],
  groupsOverage: false,
  mappings: [],
  affiliation: null,
  adminScopes: [],
  pending: [],
  ...patch,
});
const NO_FLAGS = { ambiguousMembership: false, groupsOverage: false };

describe("resolveSignIn: case 2, no mapped groups (T8)", () => {
  it("unmapped groups change nothing", () => {
    const plan = resolveSignIn(
      input({ groups: ["g-other"], mappings: [memberMap("g-1", "t1")] }),
    );
    expect(plan).toEqual({
      affiliation: { op: "keep" },
      scopePuts: [],
      scopeDeletes: [],
      pendingDeletes: [],
      flags: NO_FLAGS,
    });
  });

  it("deletes an SSO affiliation and SSO scopes that no group backs", () => {
    const plan = resolveSignIn(
      input({
        affiliation: affiliation("t1", "sso"),
        adminScopes: [scope("team", "t1", "sso")],
      }),
    );
    expect(plan.affiliation).toEqual({ op: "delete" });
    expect(plan.scopeDeletes).toEqual([{ scopeType: "team", scopeId: "t1" }]);
  });

  it("keeps a UI affiliation and UI scopes", () => {
    const plan = resolveSignIn(
      input({
        affiliation: affiliation("t1", "ui"),
        adminScopes: [scope("team", "t2", "ui")],
      }),
    );
    expect(plan.affiliation).toEqual({ op: "keep" });
    expect(plan.scopeDeletes).toEqual([]);
  });
});

describe("resolveSignIn: case 3, admin-scope mappings", () => {
  const mappings = [
    adminMap("g-a", "team", "t1"),
    adminMap("g-b", "department", "d1"),
  ];

  it("puts an SSO scope for every mapped target (several allowed)", () => {
    const plan = resolveSignIn(input({ groups: ["g-a", "g-b"], mappings }));
    expect(plan.scopePuts).toEqual(
      expect.arrayContaining([
        { scopeType: "team", scopeId: "t1", source: "sso" },
        { scopeType: "department", scopeId: "d1", source: "sso" },
      ]),
    );
    expect(plan.scopePuts).toHaveLength(2);
  });

  it("matches the SSO scopes to the mapped groups exactly", () => {
    const plan = resolveSignIn(
      input({
        groups: ["g-a"],
        mappings,
        adminScopes: [
          scope("team", "t1", "sso"),
          scope("department", "d1", "sso"),
        ],
      }),
    );
    expect(plan.scopePuts).toEqual([]);
    expect(plan.scopeDeletes).toEqual([
      { scopeType: "department", scopeId: "d1" },
    ]);
  });

  it("never touches a UI-sourced scope that no mapping covers", () => {
    const plan = resolveSignIn(
      input({
        groups: ["g-a"],
        mappings,
        adminScopes: [scope("team", "t9", "ui")],
      }),
    );
    expect(plan.scopeDeletes).toEqual([]);
  });

  it("overwrites a UI scope with SSO when a mapping covers it (SSO > UI)", () => {
    const plan = resolveSignIn(
      input({
        groups: ["g-a"],
        mappings,
        adminScopes: [scope("team", "t1", "ui")],
      }),
    );
    expect(plan.scopePuts).toEqual([
      { scopeType: "team", scopeId: "t1", source: "sso" },
    ]);
    expect(plan.scopeDeletes).toEqual([]);
  });
});

describe("resolveSignIn: case 4, one member target", () => {
  const mappings = [memberMap("g-1", "t1"), memberMap("g-2", "t2")];

  it("creates an SSO affiliation", () => {
    const plan = resolveSignIn(input({ groups: ["g-1"], mappings }));
    expect(plan.affiliation).toEqual({
      op: "put",
      teamId: "t1",
      source: "sso",
    });
    expect(plan.flags).toEqual(NO_FLAGS);
  });

  it("replaces a UI affiliation", () => {
    const plan = resolveSignIn(
      input({
        groups: ["g-1"],
        mappings,
        affiliation: affiliation("t2", "ui"),
      }),
    );
    expect(plan.affiliation).toEqual({
      op: "put",
      teamId: "t1",
      source: "sso",
    });
  });

  it("moves an SSO affiliation to the newly mapped team", () => {
    const plan = resolveSignIn(
      input({
        groups: ["g-2"],
        mappings,
        affiliation: affiliation("t1", "sso"),
      }),
    );
    expect(plan.affiliation).toEqual({
      op: "put",
      teamId: "t2",
      source: "sso",
    });
  });

  it("keeps an identical SSO affiliation (no churn)", () => {
    const plan = resolveSignIn(
      input({
        groups: ["g-1"],
        mappings,
        affiliation: affiliation("t1", "sso"),
      }),
    );
    expect(plan.affiliation).toEqual({ op: "keep" });
  });

  it("treats two groups mapping the same team as one target", () => {
    const plan = resolveSignIn(
      input({
        groups: ["g-1", "g-3"],
        mappings: [memberMap("g-1", "t1"), memberMap("g-3", "t1")],
      }),
    );
    expect(plan.affiliation).toEqual({
      op: "put",
      teamId: "t1",
      source: "sso",
    });
    expect(plan.flags.ambiguousMembership).toBe(false);
  });
});

describe("resolveSignIn: case 5, ambiguous member mappings (T8)", () => {
  const mappings = [
    memberMap("g-1", "t1"),
    memberMap("g-2", "t2"),
    adminMap("g-a", "team", "t3"),
  ];
  const groups = ["g-1", "g-2", "g-a"];

  it("applies no affiliation, sets the flag, still applies admin scopes", () => {
    const plan = resolveSignIn(input({ groups, mappings }));
    expect(plan.affiliation).toEqual({ op: "keep" });
    expect(plan.flags).toEqual({
      ambiguousMembership: true,
      groupsOverage: false,
    });
    expect(plan.scopePuts).toEqual([
      { scopeType: "team", scopeId: "t3", source: "sso" },
    ]);
  });

  it("keeps a UI affiliation", () => {
    const plan = resolveSignIn(
      input({ groups, mappings, affiliation: affiliation("t9", "ui") }),
    );
    expect(plan.affiliation).toEqual({ op: "keep" });
  });

  it("deletes an SSO affiliation (fail closed)", () => {
    const plan = resolveSignIn(
      input({ groups, mappings, affiliation: affiliation("t1", "sso") }),
    );
    expect(plan.affiliation).toEqual({ op: "delete" });
  });
});

describe("resolveSignIn: case 6, groups overage (T8)", () => {
  const mappings = [memberMap("g-1", "t1"), adminMap("g-a", "team", "t3")];

  it("writes no scopes, flags overage, and deletes an SSO affiliation", () => {
    const plan = resolveSignIn(
      input({
        groupsOverage: true,
        groups: [],
        mappings,
        affiliation: affiliation("t1", "sso"),
        adminScopes: [scope("team", "t3", "sso")],
      }),
    );
    expect(plan.affiliation).toEqual({ op: "delete" });
    expect(plan.scopePuts).toEqual([]);
    expect(plan.scopeDeletes).toEqual([]);
    expect(plan.flags).toEqual({
      ambiguousMembership: false,
      groupsOverage: true,
    });
  });

  it("keeps a UI affiliation", () => {
    const plan = resolveSignIn(
      input({
        groupsOverage: true,
        mappings,
        affiliation: affiliation("t1", "ui"),
      }),
    );
    expect(plan.affiliation).toEqual({ op: "keep" });
    expect(plan.flags.groupsOverage).toBe(true);
  });

  it("a later sign-in with a full claim clears the flags", () => {
    const plan = resolveSignIn(input({ groups: ["g-1"], mappings }));
    expect(plan.flags).toEqual(NO_FLAGS);
  });
});

describe("resolveSignIn: joiner bind (T2)", () => {
  const UPN = "jane.doe@example.com";

  it("binds a pending affiliation on a case-insensitive UPN match", () => {
    const item = pendingAffiliation(UPN, "t1");
    const plan = resolveSignIn(
      input({ upn: "Jane.Doe@Example.COM", pending: [item] }),
    );
    expect(plan.affiliation).toEqual({
      op: "put",
      teamId: "t1",
      source: "ui",
      boundFrom: UPN,
    });
    expect(plan.pendingDeletes).toEqual([{ item, reason: "bound" }]);
  });

  it("binds a pending admin scope on the UPN", () => {
    const item = pendingScope(UPN, "department", "d1");
    const plan = resolveSignIn(input({ upn: UPN, pending: [item] }));
    expect(plan.scopePuts).toEqual([
      { scopeType: "department", scopeId: "d1", source: "ui", boundFrom: UPN },
    ]);
    expect(plan.pendingDeletes).toEqual([{ item, reason: "bound" }]);
  });

  it("never binds on the email claim, with no fallback", () => {
    const plan = resolveSignIn(
      input({
        email: UPN,
        upn: "someone.else@example.com",
        pending: [pendingAffiliation(UPN, "t1")],
      }),
    );
    expect(plan.affiliation).toEqual({ op: "keep" });
    expect(plan.pendingDeletes).toEqual([]);
  });

  it("never binds when there is no UPN, even if email matches", () => {
    const plan = resolveSignIn(
      input({
        email: UPN,
        upn: undefined,
        pending: [pendingAffiliation(UPN, "t1")],
      }),
    );
    expect(plan.affiliation).toEqual({ op: "keep" });
    expect(plan.pendingDeletes).toEqual([]);
  });

  it("never binds a guest UPN containing #EXT#", () => {
    const guest = "jane.doe_example.com#EXT#@tenant.onmicrosoft.com";
    const plan = resolveSignIn(
      input({ upn: guest, pending: [pendingAffiliation(guest, "t1")] }),
    );
    expect(plan.affiliation).toEqual({ op: "keep" });
    expect(plan.scopePuts).toEqual([]);
    expect(plan.pendingDeletes).toEqual([]);
  });

  it("binds nothing when the tenant is not the configured one", () => {
    const plan = resolveSignIn(
      input({
        tid: "00000000-0000-4000-8000-0000000000bb",
        upn: UPN,
        pending: [
          pendingAffiliation(UPN, "t1"),
          pendingScope(UPN, "team", "t1"),
        ],
      }),
    );
    expect(plan.affiliation).toEqual({ op: "keep" });
    expect(plan.scopePuts).toEqual([]);
    expect(plan.pendingDeletes).toEqual([]);
  });

  it("ignores pending items for another UPN", () => {
    const plan = resolveSignIn(
      input({
        upn: UPN,
        pending: [pendingAffiliation("other@example.com", "t1")],
      }),
    );
    expect(plan.pendingDeletes).toEqual([]);
  });

  it("a single SSO member target wins and discards the invite", () => {
    const item = pendingAffiliation(UPN, "t2");
    const plan = resolveSignIn(
      input({
        upn: UPN,
        groups: ["g-1"],
        mappings: [memberMap("g-1", "t1")],
        pending: [item],
      }),
    );
    expect(plan.affiliation).toEqual({
      op: "put",
      teamId: "t1",
      source: "sso",
    });
    expect(plan.pendingDeletes).toEqual([{ item, reason: "discarded" }]);
  });

  it("an existing UI affiliation discards the invite", () => {
    const item = pendingAffiliation(UPN, "t2");
    const plan = resolveSignIn(
      input({
        upn: UPN,
        affiliation: affiliation("t1", "ui"),
        pending: [item],
      }),
    );
    expect(plan.affiliation).toEqual({ op: "keep" });
    expect(plan.pendingDeletes).toEqual([{ item, reason: "discarded" }]);
  });

  it("two pending affiliations for different teams bind neither and are kept", () => {
    const plan = resolveSignIn(
      input({
        upn: UPN,
        pending: [pendingAffiliation(UPN, "t1"), pendingAffiliation(UPN, "t2")],
      }),
    );
    expect(plan.affiliation).toEqual({ op: "keep" });
    expect(plan.pendingDeletes).toEqual([]);
  });
});
