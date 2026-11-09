import { describe, expect, it } from "vitest";

import { HealthResponseSchema } from "./health";

// Source: docs/specs/2026-11-10-platform.md — "Runtime / Health check";
// docs/specs/2026-11-10-access-control.md — "API routes" (/api/health).

const ok = {
  data: {
    status: "ok",
    dependencies: { dynamodb: "ok", litellm: "not-configured" },
  },
};

describe("HealthResponseSchema", () => {
  it("accepts an ok response", () => {
    expect(HealthResponseSchema.parse(ok)).toEqual(ok);
  });

  it("accepts a degraded response with an unreachable dependency", () => {
    const body = {
      data: {
        status: "degraded",
        dependencies: { dynamodb: "unreachable", litellm: "ok" },
      },
    };
    expect(HealthResponseSchema.parse(body)).toEqual(body);
  });

  it.each(["ok", "unreachable", "not-configured"])(
    "accepts litellm=%s",
    (litellm) => {
      expect(
        HealthResponseSchema.safeParse({
          data: { status: "ok", dependencies: { dynamodb: "ok", litellm } },
        }).success,
      ).toBe(true);
    },
  );

  it.each([
    [
      "an unknown status",
      { status: "down", dependencies: ok.data.dependencies },
    ],
    [
      "dynamodb not-configured",
      {
        status: "ok",
        dependencies: { dynamodb: "not-configured", litellm: "ok" },
      },
    ],
    [
      "an unknown litellm state",
      { status: "ok", dependencies: { dynamodb: "ok", litellm: "broken" } },
    ],
    ["missing dependencies", { status: "ok" }],
    ["missing litellm", { status: "ok", dependencies: { dynamodb: "ok" } }],
  ])("rejects %s", (_name, data) => {
    expect(HealthResponseSchema.safeParse({ data }).success).toBe(false);
  });

  it("rejects a bare object without the data envelope", () => {
    expect(HealthResponseSchema.safeParse(ok.data).success).toBe(false);
  });

  it("rejects an error envelope", () => {
    expect(
      HealthResponseSchema.safeParse({
        error: { code: "INTERNAL", message: "x" },
      }).success,
    ).toBe(false);
  });

  it("rejects extra keys that could leak internals (strict)", () => {
    expect(
      HealthResponseSchema.safeParse({
        data: { ...ok.data, tableName: "bedrock-usage" },
      }).success,
    ).toBe(false);
  });

  it("is exported from the package entry", async () => {
    const mod = await import("../index");
    expect(mod.HealthResponseSchema).toBe(HealthResponseSchema);
  });
});
