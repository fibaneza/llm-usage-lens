import { describe, expect, it } from "vitest";

import {
  ApiErrorCodeSchema,
  AuditActionSchema,
  ConnectionTestResultSchema,
  LiteLLMConnectionSchema,
  LiteLLMConnectionStatusSchema,
  liteLLMEdition,
  sanitizeAuditSnapshot,
} from "../index";

// Source: docs/specs/2026-11-10-litellm.md — "Data model additions"
// (LiteLLMConnection holds baseUrl only, versioned; edition derived from
// APP_ENV), "API routes" (error codes, connection routes), "Security
// architecture" item 6 (test results); Access Control — Audit log.
const valid = {
  baseUrl: "https://litellm.example.internal",
  version: 1,
  updatedAt: "2026-11-14T10:00:00.000Z",
};

describe("LiteLLMConnectionSchema", () => {
  it("accepts a versioned connection holding a base URL", () => {
    expect(LiteLLMConnectionSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["a non-URL baseUrl", { ...valid, baseUrl: "not a url" }],
    ["version 0", { ...valid, version: 0 }],
    ["a fractional version", { ...valid, version: 1.5 }],
    ["a missing baseUrl", { version: 1, updatedAt: valid.updatedAt }],
    ["a stored service key", { ...valid, serviceKey: "sk-fake-000" }],
    ["a stored edition (edition is derived)", { ...valid, edition: "oss" }],
  ])("rejects %s", (_name, input) => {
    expect(LiteLLMConnectionSchema.safeParse(input).success).toBe(false);
  });
});

describe("liteLLMEdition", () => {
  it("is oss in dev and enterprise in prod", () => {
    expect(liteLLMEdition("dev")).toBe("oss");
    expect(liteLLMEdition("prod")).toBe("enterprise");
  });
});

describe("LiteLLMConnectionStatusSchema", () => {
  const status = {
    baseUrl: valid.baseUrl,
    version: 1,
    edition: "oss",
    serviceKeyConfigured: true,
  };
  it("accepts a configured and an unconfigured status", () => {
    expect(LiteLLMConnectionStatusSchema.safeParse(status).success).toBe(true);
    expect(
      LiteLLMConnectionStatusSchema.safeParse({
        baseUrl: null,
        version: 0,
        edition: "enterprise",
        serviceKeyConfigured: false,
      }).success,
    ).toBe(true);
  });
  it("rejects an unknown edition and a non-boolean key flag", () => {
    expect(
      LiteLLMConnectionStatusSchema.safeParse({ ...status, edition: "x" })
        .success,
    ).toBe(false);
    expect(
      LiteLLMConnectionStatusSchema.safeParse({
        ...status,
        serviceKeyConfigured: "yes",
      }).success,
    ).toBe(false);
  });
});

describe("ConnectionTestResultSchema", () => {
  it.each([
    "ok",
    "unauthorised",
    "routes_out_of_date",
    "unreachable",
    "not_configured",
  ])("accepts result %s", (result) => {
    expect(
      ConnectionTestResultSchema.safeParse({ result, message: "m" }).success,
    ).toBe(true);
  });
  it("rejects an unknown result", () => {
    expect(
      ConnectionTestResultSchema.safeParse({ result: "maybe", message: "m" })
        .success,
    ).toBe(false);
  });
});

describe("registry additions", () => {
  it.each([
    "LITELLM_UNAVAILABLE",
    "OPERATION_UNAVAILABLE",
    "OPERATION_DISABLED",
    "PRIVILEGED_TARGET",
    "CONFLICT",
  ])("API error code %s exists", (code) => {
    expect(ApiErrorCodeSchema.safeParse(code).success).toBe(true);
  });

  it("has the litellm.connection.update audit action", () => {
    expect(
      AuditActionSchema.safeParse("litellm.connection.update").success,
    ).toBe(true);
  });

  it("lets baseUrl (and only allow-listed keys) through an audit snapshot", () => {
    expect(
      sanitizeAuditSnapshot({
        baseUrl: valid.baseUrl,
        version: 2,
        serviceKey: "sk-fake-000",
      }),
    ).toEqual({ baseUrl: valid.baseUrl, version: 2 });
  });
});
