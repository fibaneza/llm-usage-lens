import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  API_ERROR_CODES,
  ApiErrorBodySchema,
  ApiErrorCodeSchema,
  apiResponseSchema,
  apiSuccessSchema,
} from "./api";
import type { ApiErrorCode } from "./api";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes" (standard
// response shape; error codes ∈ UNAUTHORIZED | FORBIDDEN | BAD_REQUEST |
// NOT_FOUND | INTERNAL, 403 for a signed-in user without the Admin role on an
// account write route); Rule 20.11, Rule 10.4, Rule 60.22 (valid + invalid cases).

describe("API_ERROR_CODES / ApiErrorCodeSchema", () => {
  it("lists the five error codes in spec order", () => {
    expect([...API_ERROR_CODES]).toEqual([
      "UNAUTHORIZED",
      "FORBIDDEN",
      "BAD_REQUEST",
      "NOT_FOUND",
      "INTERNAL",
    ]);
  });

  it.each(API_ERROR_CODES)("accepts the known code %s", (code) => {
    expect(ApiErrorCodeSchema.safeParse(code).success).toBe(true);
  });

  it("accepts FORBIDDEN (signed in without the Admin role)", () => {
    expect(ApiErrorCodeSchema.parse("FORBIDDEN")).toBe("FORBIDDEN");
    const code: ApiErrorCode = "FORBIDDEN";
    expect(code).toBe("FORBIDDEN");
  });

  it.each([
    ["an unknown code", "TEAPOT"],
    ["FORBIDDEN in lower case", "forbidden"],
    ["FORBIDDEN with trailing whitespace", "FORBIDDEN "],
    ["a near miss", "FORBIDEN"],
    ["an empty string", ""],
    ["a number", 403],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_name, code) => {
    expect(ApiErrorCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe("ApiErrorBodySchema", () => {
  it("accepts { error: { code, message } }", () => {
    expect(
      ApiErrorBodySchema.safeParse({
        error: { code: "INTERNAL", message: "x" },
      }).success,
    ).toBe(true);
  });

  it("accepts a FORBIDDEN error body", () => {
    expect(
      ApiErrorBodySchema.safeParse({
        error: { code: "FORBIDDEN", message: "Admin role required" },
      }).success,
    ).toBe(true);
  });

  it("accepts an empty message but rejects an empty code", () => {
    expect(
      ApiErrorBodySchema.safeParse({ error: { code: "A", message: "" } })
        .success,
    ).toBe(true);
    expect(
      ApiErrorBodySchema.safeParse({ error: { code: "", message: "m" } })
        .success,
    ).toBe(false);
  });

  it.each([
    ["a bare string error", { error: "boom" }],
    ["missing message", { error: { code: "INTERNAL" } }],
    ["missing code", { error: { message: "m" } }],
    ["a success body", { data: 1 }],
    ["null", null],
  ])("rejects %s", (_name, body) => {
    expect(ApiErrorBodySchema.safeParse(body).success).toBe(false);
  });
});

describe("apiSuccessSchema", () => {
  const schema = apiSuccessSchema(z.object({ n: z.number() }));

  it("accepts { data } matching the inner schema", () => {
    expect(schema.parse({ data: { n: 1 } })).toEqual({ data: { n: 1 } });
  });

  it.each([
    ["inner schema mismatch", { data: { n: "1" } }],
    ["missing data", {}],
    ["a bare array", [{ n: 1 }]],
    ["a { result } shape", { result: { n: 1 } }],
  ])("rejects %s", (_name, body) => {
    expect(schema.safeParse(body).success).toBe(false);
  });
});

describe("apiResponseSchema", () => {
  const schema = apiResponseSchema(z.object({ n: z.number() }));

  it("accepts a success body", () => {
    expect(schema.parse({ data: { n: 2 } })).toEqual({ data: { n: 2 } });
  });

  it("accepts an error body", () => {
    const body = { error: { code: "NOT_FOUND", message: "nope" } };
    expect(schema.parse(body)).toEqual(body);
  });

  it("rejects bodies that are neither", () => {
    expect(schema.safeParse({ data: { n: "x" } }).success).toBe(false);
    expect(schema.safeParse({ error: "boom" }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse("ok").success).toBe(false);
  });
});
