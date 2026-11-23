import { describe, expect, it } from "vitest";

import { COLLECTOR_REGION } from "../region";
import {
  AccountMetaSchema,
  CreateAccountInputSchema,
  CreateAccountRequestSchema,
  UpdateAccountPatchSchema,
} from "./account-meta";

const VALID_ACCOUNT_META = {
  accountId: "000000000000",
  accountName: "payments-team-prod",
  departmentId: "dept-engineering",
  departmentName: "Engineering",
  teamId: "team-payments",
  teamName: "Payments",
  region: "ap-southeast-2",
  active: true,
  createdAt: "2026-05-15T08:00:00.000Z",
  updatedAt: "2026-05-15T08:00:00.000Z",
};

describe("AccountMetaSchema", () => {
  it("accepts a valid account", () => {
    const result = AccountMetaSchema.safeParse(VALID_ACCOUNT_META);
    expect(result.success).toBe(true);
  });

  it("accepts an ISO8601 timestamp with an offset", () => {
    expect(
      AccountMetaSchema.safeParse({
        ...VALID_ACCOUNT_META,
        updatedAt: "2026-05-15T10:00:00+02:00",
      }).success,
    ).toBe(true);
  });

  it.each([
    ["accountId", "12345"],
    ["accountId", "12345678901a"],
    ["accountName", ""],
    ["departmentId", ""],
    ["active", "yes"],
    ["createdAt", "2026-05-15"],
    ["updatedAt", "not-a-timestamp"],
  ])("rejects invalid %s %j", (field, value) => {
    expect(
      AccountMetaSchema.safeParse({ ...VALID_ACCOUNT_META, [field]: value })
        .success,
    ).toBe(false);
  });

  it("fixes COLLECTOR_REGION to ap-southeast-2 (Sydney)", () => {
    expect(COLLECTOR_REGION).toBe("ap-southeast-2");
  });

  it("accepts region ap-southeast-2", () => {
    expect(
      AccountMetaSchema.safeParse({
        ...VALID_ACCOUNT_META,
        region: "ap-southeast-2",
      }).success,
    ).toBe(true);
  });

  it.each(["us-east-1", "eu-west-1", ""])("rejects region %j", (region) => {
    expect(
      AccountMetaSchema.safeParse({ ...VALID_ACCOUNT_META, region }).success,
    ).toBe(false);
    expect(
      CreateAccountInputSchema.safeParse({
        accountId: VALID_ACCOUNT_META.accountId,
        accountName: VALID_ACCOUNT_META.accountName,
        departmentId: VALID_ACCOUNT_META.departmentId,
        departmentName: VALID_ACCOUNT_META.departmentName,
        teamId: VALID_ACCOUNT_META.teamId,
        teamName: VALID_ACCOUNT_META.teamName,
        region,
      }).success,
    ).toBe(false);
  });

  it("rejects a missing required field", () => {
    const withoutTeamName: Record<string, unknown> = { ...VALID_ACCOUNT_META };
    delete withoutTeamName.teamName;
    expect(AccountMetaSchema.safeParse(withoutTeamName).success).toBe(false);
  });
});

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AppTeam" (Ids never
// collide: the reserved `appteam-` prefix is refused for `teamId` in the two
// input schemas, amended 2026-11-17); Access Control — T-MI3.
describe("reserved appteam- teamId (T-MI3)", () => {
  const CREATE_BODY: Record<string, unknown> = { ...VALID_ACCOUNT_META };
  for (const key of ["active", "createdAt", "updatedAt"])
    delete CREATE_BODY[key];
  const RESERVED = "appteam-3f0c1a52-8b7e-4c1d-9a2f-0123456789ab";

  it("CreateAccountInputSchema accepts a registry teamId and refuses the reserved prefix", () => {
    expect(CreateAccountInputSchema.safeParse(CREATE_BODY).success).toBe(true);
    expect(
      CreateAccountInputSchema.safeParse({ ...CREATE_BODY, teamId: RESERVED })
        .success,
    ).toBe(false);
    expect(
      CreateAccountInputSchema.safeParse({ ...CREATE_BODY, teamId: "appteam-" })
        .success,
    ).toBe(false);
  });

  it("UpdateAccountPatchSchema accepts a registry teamId, an absent teamId, and refuses the reserved prefix", () => {
    expect(
      UpdateAccountPatchSchema.safeParse({ teamId: "team-payments" }).success,
    ).toBe(true);
    expect(UpdateAccountPatchSchema.safeParse({}).success).toBe(true);
    expect(
      UpdateAccountPatchSchema.safeParse({ teamId: RESERVED }).success,
    ).toBe(false);
  });

  it("AccountMetaSchema (read path) is unchanged: it does not apply the prefix check", () => {
    expect(
      AccountMetaSchema.safeParse({ ...VALID_ACCOUNT_META, teamId: RESERVED })
        .success,
    ).toBe(true);
  });
});

// D-ST5 (plan unit ST1): the POST /api/accounts body takes names; the server
// generates departmentId and teamId. Strict, so a typed id is rejected.
describe("CreateAccountRequestSchema (D-ST5)", () => {
  const REQUEST = {
    accountId: "000000000000",
    accountName: "payments-team-prod",
    departmentName: "Engineering",
    teamName: "Payments",
    region: "ap-southeast-2",
  };

  it("accepts names without ids", () => {
    expect(CreateAccountRequestSchema.safeParse(REQUEST).success).toBe(true);
  });

  it.each([
    ["departmentId", { departmentId: "dept-x" }],
    ["teamId", { teamId: "team-x" }],
    ["an unknown key", { extra: 1 }],
  ])("rejects %s (strict body)", (_n, extra) => {
    expect(
      CreateAccountRequestSchema.safeParse({ ...REQUEST, ...extra }).success,
    ).toBe(false);
  });

  it.each([
    ["accountId", { accountId: "123" }],
    ["departmentName empty", { departmentName: "" }],
    ["teamName empty", { teamName: "" }],
    ["region", { region: "us-east-1" }],
  ])("rejects an invalid %s", (_n, over) => {
    expect(
      CreateAccountRequestSchema.safeParse({ ...REQUEST, ...over }).success,
    ).toBe(false);
  });

  it.each(["departmentName", "teamName", "accountName"])(
    "rejects a missing %s",
    (key) => {
      const body: Record<string, unknown> = { ...REQUEST };
      delete body[key];
      expect(CreateAccountRequestSchema.safeParse(body).success).toBe(false);
    },
  );
});
