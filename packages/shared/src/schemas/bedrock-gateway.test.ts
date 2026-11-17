import { describe, expect, it } from "vitest";

import {
  BedrockGatewayConfigSchema,
  BedrockGatewayPutSchema,
  BedrockGatewayViewSchema,
} from "../index";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage (L6)
// -> Gateway configuration" (Schema, strict: principals <= 20 of
// { type: "iam-role" | "usage-key", value }, accountIds <= 10 of 12 digits,
// version int >= 1, updatedAt, updatedBy; Validation: iam-role trimmed and
// matching ^[\w+=,.@-]{1,64}$, usage-key trimmed, 1-512 characters, no control
// characters, a value whose canonical usage identity is a person (an email) is
// refused in both types, duplicates after normalisation refused, both lists
// empty allowed; Route: PUT body { version: number | null, principals,
// accountIds }, no stored item -> { gatewayConfigured: false, version: 0,
// principals: [], accountIds: [] }), LD38, LT29; Rule 60.22 (valid + invalid).
//
// Contract for the developer (packages/shared/src/schemas/bedrock-gateway.ts,
// re-exported from index.ts): BedrockGatewayConfigSchema (stored/response item),
// BedrockGatewayPutSchema (the PUT body; output has trimmed values),
// BedrockGatewayViewSchema (GET/PUT response data) and their inferred types.

const principals = [
  { type: "iam-role", value: "litellm-bedrock" },
  { type: "usage-key", value: "svc-gateway" },
];
const body = { version: null, principals, accountIds: ["123456789012"] };
const put = (patch: Record<string, unknown>) =>
  BedrockGatewayPutSchema.safeParse({ ...body, ...patch });
const withPrincipals = (list: unknown[]) => put({ principals: list });
const role = (value: string) => ({ type: "iam-role", value });
const key = (value: string) => ({ type: "usage-key", value });

describe("BedrockGatewayPutSchema", () => {
  it("accepts a create body (version null) and an update body (version >= 1)", () => {
    expect(put({}).success).toBe(true);
    expect(put({ version: 3 }).success).toBe(true);
  });

  it("accepts both lists empty: that means clear", () => {
    expect(put({ principals: [], accountIds: [] }).success).toBe(true);
  });

  it("trims principal values and keeps their case", () => {
    const parsed = withPrincipals([role("  LiteLLM-Bedrock "), key(" k1 ")]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.principals).toEqual([
      role("LiteLLM-Bedrock"),
      key("k1"),
    ]);
  });

  it.each([
    ["version 0", { version: 0 }],
    ["a fractional version", { version: 1.5 }],
    ["a missing version", { version: undefined }],
    ["an unknown field", { extra: true }],
    [
      "an unknown principal type",
      { principals: [{ type: "user", value: "x" }] },
    ],
    [
      "a principal with an extra field",
      { principals: [{ ...role("r"), x: 1 }] },
    ],
  ])("rejects %s (strict body)", (_name, patch) => {
    expect(put(patch).success).toBe(false);
  });

  describe("iam-role values (^[\\w+=,.@-]{1,64}$ after trimming)", () => {
    it.each(["a", "litellm-bedrock", "Role_1+x=y,z.w@v-1", "a".repeat(64)])(
      "accepts %s",
      (value) => expect(withPrincipals([role(value)]).success).toBe(true),
    );
    it.each([
      ["empty", ""],
      ["only whitespace", "   "],
      ["65 characters", "a".repeat(65)],
      ["a space inside", "two words"],
      ["a slash (a path is not a role name)", "service-role/x"],
      ["a colon", "role:x"],
    ])("rejects %s", (_n, value) =>
      expect(withPrincipals([role(value)]).success).toBe(false),
    );
  });

  describe("usage-key values (1-512 characters, no control characters)", () => {
    it.each(["k", "AROAXXXXXXXXXXXXXXXXX:litellm-session", "x".repeat(512)])(
      "accepts %s",
      (value) => expect(withPrincipals([key(value)]).success).toBe(true),
    );
    it.each([
      ["empty", ""],
      ["only whitespace", "   "],
      ["513 characters", "x".repeat(513)],
      ["a control character", "a\u0001b"],
      ["a newline", "a\nb"],
      ["a tab", "a\tb"],
    ])("rejects %s", (_n, value) =>
      expect(withPrincipals([key(value)]).success).toBe(false),
    );
  });

  // LT29: excluding a person's key would hide real usage. Complete for both
  // types (security matrix, Rule 60.24a).
  describe.each([role, key])("a person key as a principal (LT29)", (make) => {
    it.each([
      "alice@example.com",
      "Alice@Example.COM",
      "  alice@example.com  ",
      "arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_Dev_abc/alice@example.com",
    ])("refuses %s", (value) =>
      expect(withPrincipals([make(value)]).success).toBe(false),
    );
  });

  it("accepts a non-email service identity as a usage-key", () => {
    expect(withPrincipals([key("svc-gateway@internal")]).success).toBe(true);
  });

  describe("limits", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => key(`key-${i}`));
    it("accepts 20 principals and refuses 21", () => {
      expect(withPrincipals(many(20)).success).toBe(true);
      expect(withPrincipals(many(21)).success).toBe(false);
    });
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => String(100000000000 + i));
    it("accepts 10 account ids and refuses 11", () => {
      expect(put({ accountIds: ids(10) }).success).toBe(true);
      expect(put({ accountIds: ids(11) }).success).toBe(false);
    });
  });

  describe("account ids", () => {
    it.each([
      "12345678901",
      "1234567890123",
      "12345678901a",
      "",
      " 123456789012",
    ])("refuses %j (not 12 digits)", (id) =>
      expect(put({ accountIds: [id] }).success).toBe(false),
    );
  });

  // Spec - Gateway configuration, Validation: duplicates refused, account ids
  // included (L6 review round 1; amended 2026-11-17).
  describe("duplicate account ids", () => {
    it("refuses the same account id twice", () =>
      expect(
        put({ accountIds: ["123456789012", "123456789012"] }).success,
      ).toBe(false));
    it("refuses it when other ids sit between the copies", () =>
      expect(
        put({ accountIds: ["123456789012", "111122223333", "123456789012"] })
          .success,
      ).toBe(false));
    it("accepts distinct ids", () =>
      expect(
        put({ accountIds: ["123456789012", "111122223333"] }).success,
      ).toBe(true));
  });

  describe("duplicates after normalisation", () => {
    it.each([
      ["the same iam-role twice", [role("r1"), role("r1")]],
      ["iam-roles differing only by case", [role("Litellm"), role("litellm")]],
      ["iam-roles differing only by whitespace", [role("r1"), role(" r1 ")]],
      ["the same usage-key twice", [key("k1"), key("k1")]],
      ["usage-keys differing only by whitespace", [key("k1"), key(" k1 ")]],
    ])("refuses %s", (_n, list) =>
      expect(withPrincipals(list).success).toBe(false),
    );
  });
});

describe("BedrockGatewayConfigSchema (the stored item)", () => {
  const stored = {
    principals,
    accountIds: ["123456789012"],
    version: 1,
    updatedAt: "2026-11-17T10:00:00.000Z",
    updatedBy: "00000000-0000-4000-8000-0000000000aa",
  };
  it("accepts a stored item", () => {
    expect(BedrockGatewayConfigSchema.safeParse(stored).success).toBe(true);
  });
  it.each([
    ["version 0", { version: 0 }],
    ["a missing updatedBy", { updatedBy: undefined }],
    ["a bad timestamp", { updatedAt: "yesterday" }],
    ["an unknown field", { extra: 1 }],
    ["duplicate account ids", { accountIds: ["123456789012", "123456789012"] }],
  ])("rejects %s", (_n, patch) => {
    expect(
      BedrockGatewayConfigSchema.safeParse({ ...stored, ...patch }).success,
    ).toBe(false);
  });
});

describe("BedrockGatewayViewSchema (GET/PUT response data)", () => {
  it("accepts the never-configured answer exactly as the spec words it", () => {
    const empty = {
      gatewayConfigured: false,
      version: 0,
      principals: [],
      accountIds: [],
    };
    expect(BedrockGatewayViewSchema.parse(empty)).toEqual(empty);
  });
  it("accepts a configured answer with who and when", () => {
    expect(
      BedrockGatewayViewSchema.safeParse({
        gatewayConfigured: true,
        version: 2,
        principals,
        accountIds: [],
        updatedAt: "2026-11-17T10:00:00.000Z",
        updatedBy: "00000000-0000-4000-8000-0000000000aa",
      }).success,
    ).toBe(true);
  });
  it("requires gatewayConfigured", () => {
    expect(
      BedrockGatewayViewSchema.safeParse({
        version: 0,
        principals: [],
        accountIds: [],
      }).success,
    ).toBe(false);
  });
});
