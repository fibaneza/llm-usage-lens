import { describe, expect, it } from "vitest";

import { MODEL_KEYS } from "../models";
import {
  DepartmentDetailResponseSchema,
  DepartmentsResponseSchema,
  ServiceListRowSchema,
  ServicesResponseSchema,
  TeamDetailResponseSchema,
  TeamsResponseSchema,
} from "./api-responses";

// Source: docs/specs/2026-05-15-data-model.md -- "Zod Validation Schemas"
// (`DepartmentsResponseSchema`: department rows also carry `teamCount` and
// `topModel`, decided 2026-11-04; `DepartmentDetailResponseSchema` is the
// department row plus detail sections); implementation-phases Phase 4.3;
// Rules 20.11, 60.22 (valid + invalid cases).
const DEPARTMENT_ROW = {
  departmentId: "dept-eng",
  departmentName: "Engineering",
  cost: 600,
  modelCost: 550,
  nonModelCost: 50,
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  invocations: 1_200,
  teamCount: 3,
  topModel: "claude-opus",
};

const DETAIL = {
  ...DEPARTMENT_ROW,
  nonModelByCategory: [],
  teams: [],
  dailyTrend: [],
  topUsers: [],
  teamTrend: [],
};

function without<T extends Record<string, unknown>>(
  value: T,
  key: keyof T,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value };
  delete copy[key as string];
  return copy;
}

describe("DepartmentsResponseSchema -- teamCount and topModel", () => {
  it("accepts a department row with a team count and a top model", () => {
    const parsed = DepartmentsResponseSchema.parse({
      departments: [DEPARTMENT_ROW],
    });

    expect(parsed.departments[0]).toMatchObject({
      teamCount: 3,
      topModel: "claude-opus",
    });
  });

  it.each(MODEL_KEYS)("accepts topModel %s", (topModel) => {
    expect(
      DepartmentsResponseSchema.safeParse({
        departments: [{ ...DEPARTMENT_ROW, topModel }],
      }).success,
    ).toBe(true);
  });

  it("accepts topModel null (no model has invocations in the range)", () => {
    const parsed = DepartmentsResponseSchema.parse({
      departments: [{ ...DEPARTMENT_ROW, topModel: null }],
    });

    expect(parsed.departments[0]?.topModel).toBeNull();
  });

  it("accepts a team count of zero", () => {
    expect(
      DepartmentsResponseSchema.safeParse({
        departments: [{ ...DEPARTMENT_ROW, teamCount: 0 }],
      }).success,
    ).toBe(true);
  });

  it("accepts an empty departments list", () => {
    expect(DepartmentsResponseSchema.parse({ departments: [] })).toEqual({
      departments: [],
    });
  });

  it("keeps the existing totals on the row", () => {
    const parsed = DepartmentsResponseSchema.parse({
      departments: [DEPARTMENT_ROW],
    });

    expect(parsed.departments[0]).toEqual(DEPARTMENT_ROW);
  });

  it.each([
    ["a missing teamCount", without(DEPARTMENT_ROW, "teamCount")],
    [
      "a missing topModel (null is explicit, absent is not)",
      without(DEPARTMENT_ROW, "topModel"),
    ],
    ["a negative teamCount", { ...DEPARTMENT_ROW, teamCount: -1 }],
    ["a fractional teamCount", { ...DEPARTMENT_ROW, teamCount: 1.5 }],
    ["a string teamCount", { ...DEPARTMENT_ROW, teamCount: "3" }],
    ["a null teamCount", { ...DEPARTMENT_ROW, teamCount: null }],
    ["a NaN teamCount", { ...DEPARTMENT_ROW, teamCount: Number.NaN }],
    ["an unknown topModel key", { ...DEPARTMENT_ROW, topModel: "gpt-4" }],
    [
      "a raw Bedrock model id as topModel",
      {
        ...DEPARTMENT_ROW,
        topModel: "anthropic.claude-3-5-sonnet-20240620-v1:0",
      },
    ],
    ["an empty-string topModel", { ...DEPARTMENT_ROW, topModel: "" }],
    [
      "a display name as topModel",
      { ...DEPARTMENT_ROW, topModel: "Claude Opus" },
    ],
    ["a numeric topModel", { ...DEPARTMENT_ROW, topModel: 1 }],
  ])("rejects %s", (_name, row) => {
    expect(
      DepartmentsResponseSchema.safeParse({ departments: [row] }).success,
    ).toBe(false);
  });

  it("rejects the whole list when any one row is invalid", () => {
    expect(
      DepartmentsResponseSchema.safeParse({
        departments: [
          DEPARTMENT_ROW,
          { ...DEPARTMENT_ROW, departmentId: "dept-x", teamCount: -2 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("DepartmentDetailResponseSchema -- carries the department row's fields", () => {
  it("accepts a detail with teamCount and topModel", () => {
    const parsed = DepartmentDetailResponseSchema.parse(DETAIL);

    expect(parsed).toMatchObject({ teamCount: 3, topModel: "claude-opus" });
  });

  it("accepts topModel null on the detail", () => {
    expect(
      DepartmentDetailResponseSchema.safeParse({ ...DETAIL, topModel: null })
        .success,
    ).toBe(true);
  });

  it.each([
    ["a missing teamCount", without(DETAIL, "teamCount")],
    ["a missing topModel", without(DETAIL, "topModel")],
    ["a negative teamCount", { ...DETAIL, teamCount: -1 }],
    ["a fractional teamCount", { ...DETAIL, teamCount: 0.5 }],
    ["an unknown topModel key", { ...DETAIL, topModel: "gpt-4" }],
  ])("rejects %s", (_name, detail) => {
    expect(DepartmentDetailResponseSchema.safeParse(detail).success).toBe(
      false,
    );
  });

  it("still requires the detail sections", () => {
    expect(
      DepartmentDetailResponseSchema.safeParse(DEPARTMENT_ROW).success,
    ).toBe(false);
  });
});

// Source: docs/specs/2026-05-15-data-model.md -- "Zod Validation Schemas",
// `TeamsResponseSchema`: team rows carry `serviceCount` and `userCount`
// (non-negative integers; 0 is a real count); `TeamDetailResponseSchema`
// inherits both; implementation-phases Phase 4.5; Rule 60.22.
const TEAM_ROW = {
  teamId: "team-payments",
  teamName: "Payments",
  departmentId: "dept-eng",
  departmentName: "Engineering",
  cost: 600,
  modelCost: 550,
  nonModelCost: 50,
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  invocations: 1_200,
  serviceCount: 4,
  userCount: 7,
};

describe("TeamsResponseSchema -- serviceCount and userCount", () => {
  it("accepts a team row with both counts", () => {
    const parsed = TeamsResponseSchema.parse({ teams: [TEAM_ROW] });
    expect(parsed.teams[0]).toMatchObject({ serviceCount: 4, userCount: 7 });
  });

  it("accepts zero for both counts", () => {
    expect(
      TeamsResponseSchema.safeParse({
        teams: [{ ...TEAM_ROW, serviceCount: 0, userCount: 0 }],
      }).success,
    ).toBe(true);
  });

  it.each(["serviceCount", "userCount"] as const)("requires %s", (key) => {
    expect(
      TeamsResponseSchema.safeParse({ teams: [without(TEAM_ROW, key)] })
        .success,
    ).toBe(false);
  });

  it.each(["serviceCount", "userCount"] as const)(
    "rejects a negative, fractional or non-numeric %s",
    (key) => {
      for (const bad of [-1, 1.5, "3", null]) {
        expect(
          TeamsResponseSchema.safeParse({
            teams: [{ ...TEAM_ROW, [key]: bad }],
          }).success,
        ).toBe(false);
      }
    },
  );
});

describe("TeamDetailResponseSchema -- inherits serviceCount and userCount", () => {
  const TEAM_DETAIL = {
    ...TEAM_ROW,
    nonModelByCategory: [],
    accounts: [],
    dailyTrend: [],
    byModel: [],
    services: [],
    users: [],
  };

  it("accepts a detail body carrying both counts", () => {
    const parsed = TeamDetailResponseSchema.parse(TEAM_DETAIL);
    expect(parsed).toMatchObject({ serviceCount: 4, userCount: 7 });
  });

  it.each(["serviceCount", "userCount"] as const)("requires %s", (key) => {
    expect(
      TeamDetailResponseSchema.safeParse(without(TEAM_DETAIL, key)).success,
    ).toBe(false);
  });
});

// Source: docs/specs/2026-05-15-data-model.md -- "Zod Validation Schemas"
// (`ServicesResponseSchema`: one row per team and service carrying `teamId`,
// `teamName`, `departmentId`, `departmentName`; decided 2026-11-06);
// implementation-phases Phase 4.7; Rules 20.11, 60.22. Team Detail's
// `services[]` row stays the name-only `ServiceRowSchema`.
const SERVICE_LIST_ROW = {
  serviceName: "payments-api",
  teamId: "team-pay",
  teamName: "Payments",
  departmentId: "dept-eng",
  departmentName: "Engineering",
  cost: 12.5,
  costEstimated: true,
  inputTokens: 1_000,
  outputTokens: 500,
  invocations: 10,
};

describe("ServicesResponseSchema -- per-team service rows", () => {
  it("accepts a row carrying team and department identity", () => {
    const parsed = ServicesResponseSchema.parse({
      services: [SERVICE_LIST_ROW],
    });
    expect(parsed.services[0]).toMatchObject({
      teamId: "team-pay",
      teamName: "Payments",
      departmentId: "dept-eng",
      departmentName: "Engineering",
    });
  });

  it("exports ServiceListRowSchema that accepts the same row", () => {
    expect(ServiceListRowSchema.safeParse(SERVICE_LIST_ROW).success).toBe(true);
  });

  it("accepts an empty list", () => {
    expect(ServicesResponseSchema.parse({ services: [] }).services).toEqual([]);
  });

  it.each(["teamId", "teamName", "departmentId", "departmentName"] as const)(
    "rejects a row missing %s",
    (key) => {
      expect(
        ServicesResponseSchema.safeParse({
          services: [without(SERVICE_LIST_ROW, key)],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects costEstimated other than true", () => {
    expect(
      ServicesResponseSchema.safeParse({
        services: [{ ...SERVICE_LIST_ROW, costEstimated: false }],
      }).success,
    ).toBe(false);
  });

  it("rejects a negative cost and a non-integer invocation count", () => {
    expect(
      ServicesResponseSchema.safeParse({
        services: [{ ...SERVICE_LIST_ROW, cost: -1 }],
      }).success,
    ).toBe(false);
    expect(
      ServicesResponseSchema.safeParse({
        services: [{ ...SERVICE_LIST_ROW, invocations: 1.5 }],
      }).success,
    ).toBe(false);
  });

  it("leaves Team Detail's services[] row name-only (no team fields required)", () => {
    const { teamId, teamName, departmentId, departmentName, ...nameOnly } =
      SERVICE_LIST_ROW;
    void [teamId, teamName, departmentId, departmentName];
    const detail = TeamDetailResponseSchema.safeParse({
      teamId: "team-pay",
      teamName: "Payments",
      departmentId: "dept-eng",
      departmentName: "Engineering",
      cost: 1,
      modelCost: 1,
      nonModelCost: 0,
      inputTokens: 0,
      outputTokens: 0,
      invocations: 0,
      serviceCount: 1,
      userCount: 0,
      nonModelByCategory: [],
      accounts: [],
      dailyTrend: [],
      byModel: [],
      services: [nameOnly],
      users: [],
    });
    expect(detail.success).toBe(true);
  });
});
