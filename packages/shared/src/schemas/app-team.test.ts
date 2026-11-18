import { describe, expect, it } from "vitest";

import {
  AppTeamIdSchema,
  AppTeamNameSchema,
  AppTeamSchema,
  CreateAppTeamInputSchema,
  OrgUnitsResponseSchema,
  appTeamNameKey,
  isReservedTeamId,
} from "./app-team";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AppTeam";
// docs/specs/2026-11-10-access-control.md — "Created app teams", T-MI3.
const ID = "appteam-3f0c1a52-8b7e-4c1d-9a2f-0123456789ab";
const TEAM = {
  teamId: ID,
  name: "Platform Guild",
  departmentId: "dept-eng",
  departmentName: "Engineering",
  createdBy: "00000000-0000-4000-8000-0000000000aa",
  createdAt: "2026-11-18T10:00:00.000Z",
  version: 1,
};

describe("AppTeamIdSchema (Entity: AppTeam — appteam-<uuid v4>)", () => {
  it("accepts appteam- plus a v4 uuid", () => {
    expect(AppTeamIdSchema.safeParse(ID).success).toBe(true);
  });

  it.each([
    ["a bare uuid", "3f0c1a52-8b7e-4c1d-9a2f-0123456789ab"],
    ["a registry id", "team-payments"],
    ["a non-v4 uuid", "appteam-3f0c1a52-8b7e-1c1d-9a2f-0123456789ab"],
    ["a bad variant", "appteam-3f0c1a52-8b7e-4c1d-1a2f-0123456789ab"],
    ["an upper-case prefix", `APPTEAM-${ID.slice(8)}`],
    ["a trailing suffix", `${ID}x`],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(AppTeamIdSchema.safeParse(value).success).toBe(false);
  });
});

describe("AppTeamNameSchema (1-80 characters after trimming)", () => {
  it("trims and accepts the 1 and 80 character boundaries", () => {
    expect(AppTeamNameSchema.parse("  Platform Guild  ")).toBe(
      "Platform Guild",
    );
    expect(AppTeamNameSchema.safeParse("a").success).toBe(true);
    expect(AppTeamNameSchema.safeParse("a".repeat(80)).success).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["81 characters", "a".repeat(81)],
  ])("rejects %s", (_label, value) => {
    expect(AppTeamNameSchema.safeParse(value).success).toBe(false);
  });
});

describe("AppTeamSchema", () => {
  it("accepts a stored team", () => {
    expect(AppTeamSchema.safeParse(TEAM).success).toBe(true);
  });

  it.each([
    ["teamId", { teamId: "team-payments" }],
    ["version below 1", { version: 0 }],
    ["createdAt", { createdAt: "yesterday" }],
    ["empty departmentId", { departmentId: "" }],
    ["empty createdBy", { createdBy: "" }],
  ])("rejects an invalid %s", (_label, patch) => {
    expect(AppTeamSchema.safeParse({ ...TEAM, ...patch }).success).toBe(false);
  });

  it("rejects a missing departmentName", () => {
    const rest: Record<string, unknown> = { ...TEAM };
    delete rest.departmentName;
    expect(AppTeamSchema.safeParse(rest).success).toBe(false);
  });
});

describe("CreateAppTeamInputSchema (T-MI3: the id is server-generated)", () => {
  const body = { name: "Platform Guild", departmentId: "dept-eng" };

  it("accepts name and departmentId, trimming the name", () => {
    expect(
      CreateAppTeamInputSchema.parse({ ...body, name: "  Platform Guild " }),
    ).toEqual(body);
  });

  it.each([
    ["a body teamId", { teamId: ID }],
    ["a registry-looking teamId", { teamId: "team-payments" }],
    ["any extra key", { createdBy: "someone" }],
  ])("refuses %s (strict)", (_label, extra) => {
    expect(
      CreateAppTeamInputSchema.safeParse({ ...body, ...extra }).success,
    ).toBe(false);
  });

  it.each([
    ["an empty name", { name: "  " }],
    ["an 81 character name", { name: "a".repeat(81) }],
    ["a blank departmentId", { departmentId: "   " }],
    ["a 129 character departmentId", { departmentId: "d".repeat(129) }],
  ])("rejects %s", (_label, patch) => {
    expect(
      CreateAppTeamInputSchema.safeParse({ ...body, ...patch }).success,
    ).toBe(false);
  });

  it("rejects a missing departmentId", () => {
    expect(CreateAppTeamInputSchema.safeParse({ name: "X" }).success).toBe(
      false,
    );
  });
});

describe("appTeamNameKey (AppTeamNameClaim key: lower(trim(name)))", () => {
  it("trims and lower-cases", () => {
    expect(appTeamNameKey("  Platform GUILD ")).toBe("platform guild");
    expect(appTeamNameKey("Platform Guild")).toBe(
      appTeamNameKey("platform guild"),
    );
  });
});

describe("isReservedTeamId (reserved appteam- prefix)", () => {
  it.each([
    [ID, true],
    ["appteam-", true],
    ["appteam-anything", true],
    ["team-payments", false],
    ["my-appteam-x", false],
    ["AppTeam-x", false],
  ])("%s -> %s", (id, expected) => {
    expect(isReservedTeamId(id)).toBe(expected);
  });
});

describe("OrgUnitsResponseSchema (org-units lists hasAwsAccount)", () => {
  const base = {
    departments: [{ id: "dept-eng", name: "Engineering" }],
    teams: [
      {
        id: "team-a",
        name: "A",
        departmentId: "dept-eng",
        hasAwsAccount: true,
      },
      { id: ID, name: "B", departmentId: "dept-eng", hasAwsAccount: false },
    ],
  };

  it("accepts team rows that carry hasAwsAccount", () => {
    expect(OrgUnitsResponseSchema.safeParse(base).success).toBe(true);
  });

  it("requires hasAwsAccount on every team row", () => {
    const row: Record<string, unknown> = { ...base.teams[0] };
    delete row.hasAwsAccount;
    expect(
      OrgUnitsResponseSchema.safeParse({
        ...base,
        teams: [row, base.teams[1]],
      }).success,
    ).toBe(false);
  });

  it("rejects a non-boolean hasAwsAccount", () => {
    expect(
      OrgUnitsResponseSchema.safeParse({
        ...base,
        teams: [{ ...base.teams[0], hasAwsAccount: "yes" }],
      }).success,
    ).toBe(false);
  });
});
