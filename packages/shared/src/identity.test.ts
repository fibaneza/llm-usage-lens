import { describe, expect, it } from "vitest";

import { IdentityRecordSchema } from "./identity";

// Source: docs/specs/2026-11-10-access-control.md — "Data model additions"
// (Identity row); contract r1 decision 5.
const VALID = {
  oid: "00000000-0000-0000-0000-000000000001",
  tid: "00000000-0000-0000-0000-000000000002",
  email: "ada@example.com",
  upn: "ada@example.com",
  displayName: "Ada",
  lastSignInAt: "2026-11-10T10:00:00.000Z",
  lastSeenRoles: ["internal-viewer"],
  authMethod: "entra",
  version: 1,
};

describe("IdentityRecordSchema", () => {
  it("accepts a full record", () => {
    expect(IdentityRecordSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts a record without optional email, upn and displayName", () => {
    const rest: Record<string, unknown> = { ...VALID };
    delete rest.email;
    delete rest.upn;
    delete rest.displayName;
    expect(IdentityRecordSchema.safeParse(rest).success).toBe(true);
  });

  it.each(["entra", "master", "local"])("accepts authMethod %s", (m) => {
    expect(
      IdentityRecordSchema.safeParse({ ...VALID, authMethod: m }).success,
    ).toBe(true);
  });

  it.each([
    ["unknown authMethod", { authMethod: "saml" }],
    ["empty oid", { oid: "" }],
    ["missing oid", { oid: undefined }],
    ["missing tid", { tid: undefined }],
    ["non-ISO lastSignInAt", { lastSignInAt: "yesterday" }],
    ["missing lastSignInAt", { lastSignInAt: undefined }],
    ["non-array lastSeenRoles", { lastSeenRoles: "internal-admin" }],
    ["non-string role", { lastSeenRoles: [1] }],
    ["missing version", { version: undefined }],
    ["non-integer version", { version: 1.5 }],
    ["negative version", { version: -1 }],
  ])("rejects %s", (_n, patch) => {
    expect(IdentityRecordSchema.safeParse({ ...VALID, ...patch }).success).toBe(
      false,
    );
  });
});
