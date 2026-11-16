import { describe, expect, it } from "vitest";

import { GroupMappingBaseSchema, GroupMappingSchema } from "./group-mapping";
import { GroupMappingInputSchema } from "./index";

// Source: docs/specs/2026-11-10-access-control.md — Threat model T4 (a group
// mapping can never grant a global role). Contract R1 decision 11.
const ok = (scopedRole: string, type = "team") => ({
  groupId: "group-1",
  target: { type, id: "team-a" },
  scopedRole,
});

describe("GroupMappingInputSchema", () => {
  it("accepts team-admin and member on a team", () => {
    expect(
      GroupMappingInputSchema.safeParse(ok("internal-team-admin")).success,
    ).toBe(true);
    expect(GroupMappingInputSchema.safeParse(ok("member")).success).toBe(true);
  });

  it("accepts team-admin on a department", () => {
    expect(
      GroupMappingInputSchema.safeParse(ok("internal-team-admin", "department"))
        .success,
    ).toBe(true);
  });

  it("rejects member on a department", () => {
    expect(
      GroupMappingInputSchema.safeParse(ok("member", "department")).success,
    ).toBe(false);
  });

  it.each([
    "internal-admin",
    "internal-org-admin",
    "internal-auditor",
    "internal-viewer",
    "Admin",
    "",
  ])("rejects the global/unknown role %j", (role) => {
    expect(GroupMappingInputSchema.safeParse(ok(role)).success).toBe(false);
    expect(
      GroupMappingInputSchema.safeParse(ok(role, "department")).success,
    ).toBe(false);
  });

  it("rejects empty groupId, unknown target type, missing fields", () => {
    expect(
      GroupMappingInputSchema.safeParse({ ...ok("member"), groupId: "" })
        .success,
    ).toBe(false);
    expect(GroupMappingInputSchema.safeParse(ok("member", "org")).success).toBe(
      false,
    );
    expect(GroupMappingInputSchema.safeParse({ groupId: "g" }).success).toBe(
      false,
    );
  });

  // 4R.4 slice-1 review warning: target.id was unbounded. 128 matches the
  // group id bound on the routes (GroupIdSchema) and is far above any team or
  // department id.
  it("bounds target.id at 128 characters", () => {
    const withId = (id: string, type = "team") => ({
      ...ok("member"),
      target: { type, id },
    });
    expect(
      GroupMappingInputSchema.safeParse(withId("t".repeat(128))).success,
    ).toBe(true);
    expect(
      GroupMappingInputSchema.safeParse(withId("t".repeat(129))).success,
    ).toBe(false);
    expect(
      GroupMappingInputSchema.safeParse({
        ...ok("internal-team-admin", "department"),
        target: { type: "department", id: "d".repeat(129) },
      }).success,
    ).toBe(false);
  });
});

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
