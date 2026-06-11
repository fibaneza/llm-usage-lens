import { describe, expect, it } from "vitest";

import { AccountMetaSchema } from "./account-meta";

const VALID_ACCOUNT_META = {
  accountId: "123456789012",
  accountName: "payments-team-prod",
  departmentId: "dept-engineering",
  departmentName: "Engineering",
  teamId: "team-payments",
  teamName: "Payments",
  region: "us-east-1",
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
    ["region", ""],
    ["active", "yes"],
    ["createdAt", "2026-05-15"],
    ["updatedAt", "not-a-timestamp"],
  ])("rejects invalid %s %j", (field, value) => {
    expect(
      AccountMetaSchema.safeParse({ ...VALID_ACCOUNT_META, [field]: value })
        .success,
    ).toBe(false);
  });

  it("rejects a missing required field", () => {
    const withoutTeamName: Record<string, unknown> = { ...VALID_ACCOUNT_META };
    delete withoutTeamName.teamName;
    expect(AccountMetaSchema.safeParse(withoutTeamName).success).toBe(false);
  });
});
