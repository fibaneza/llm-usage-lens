import { describe, expect, it } from "vitest";

import { GroupMappingBaseSchema, GroupMappingSchema } from "./group-mapping";
import { IdentityRecordSchema } from "./identity";

// Source: docs/specs/2026-11-10-access-control.md — "Data model additions"
// (GroupMapping row), T4; contract R2 §3 "Changes to existing shared files".
const memberOnDept = {
  groupId: "g-1",
  target: { type: "department", id: "d1" },
  scopedRole: "member",
};
const stored = {
  groupId: "g-1",
  target: { type: "team", id: "t1" },
  scopedRole: "member",
  version: 1,
  updatedAt: "2026-11-12T00:00:00.000Z",
};

describe("GroupMappingBaseSchema", () => {
  it("is unrefined: it parses member on a department", () => {
    expect(GroupMappingBaseSchema.safeParse(memberOnDept).success).toBe(true);
  });
});

describe("GroupMappingSchema", () => {
  it("accepts a stored mapping", () => {
    expect(GroupMappingSchema.safeParse(stored).success).toBe(true);
  });

  it("keeps the member-on-team-only refinement", () => {
    expect(
      GroupMappingSchema.safeParse({ ...stored, ...memberOnDept }).success,
    ).toBe(false);
  });

  it.each([
    ["missing version", { version: undefined }],
    ["negative version", { version: -1 }],
    ["missing updatedAt", { updatedAt: undefined }],
    ["bad updatedAt", { updatedAt: "yesterday" }],
  ])("rejects %s", (_name, patch) => {
    expect(GroupMappingSchema.safeParse({ ...stored, ...patch }).success).toBe(
      false,
    );
  });
});

describe("IdentityRecordSchema optional R2 fields", () => {
  const base = {
    oid: "00000000-0000-4000-8000-000000000001",
    tid: "00000000-0000-4000-8000-000000000002",
    lastSignInAt: "2026-11-12T00:00:00.000Z",
    lastSeenRoles: [],
    authMethod: "entra",
    version: 0,
  };

  it("parses without the new fields", () => {
    expect(IdentityRecordSchema.safeParse(base).success).toBe(true);
  });

  it("accepts the flags and lockout fields", () => {
    const parsed = IdentityRecordSchema.parse({
      ...base,
      ambiguousMembership: true,
      groupsOverage: false,
      failedAttempts: 2,
      lockedUntil: "2026-11-12T00:15:00.000Z",
    });
    expect(parsed.ambiguousMembership).toBe(true);
    expect(parsed.groupsOverage).toBe(false);
    expect(parsed.failedAttempts).toBe(2);
  });

  it("rejects non-boolean flags and a negative failedAttempts", () => {
    expect(
      IdentityRecordSchema.safeParse({ ...base, groupsOverage: "yes" }).success,
    ).toBe(false);
    expect(
      IdentityRecordSchema.safeParse({ ...base, failedAttempts: -1 }).success,
    ).toBe(false);
  });
});
