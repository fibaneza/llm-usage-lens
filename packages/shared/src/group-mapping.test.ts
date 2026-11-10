import { describe, expect, it } from "vitest";

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
});
