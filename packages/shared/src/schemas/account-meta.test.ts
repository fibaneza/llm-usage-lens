import { describe, expect, it } from "vitest";

import { COLLECTOR_REGION } from "../region";
import { AccountMetaSchema, CreateAccountInputSchema } from "./account-meta";

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
