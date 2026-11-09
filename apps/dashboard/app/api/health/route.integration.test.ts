import { HealthResponseSchema } from "@llm-usage-lens/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { TEST_TABLE_NAME, ensureTestTable } from "@/test/test-support";

// Source: docs/specs/2026-11-10-access-control.md — "API routes" (/api/health:
// no session, no data, Cache-Control private no-store); docs/specs/
// 2026-11-10-platform.md — "Runtime / Health check" (always 200 while the
// process serves; status "degraded" when DynamoDB is unreachable; the body
// never contains the table name or an error message). Rule 10.3 exception.

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const dynamo = vi.hoisted(() => ({
  override: undefined as "unreachable" | undefined,
}));
vi.mock("@/lib/data/health", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/data/health")>(
      "@/lib/data/health",
    );
  return {
    ...actual,
    checkDynamoDb: async () => dynamo.override ?? actual.checkDynamoDb(),
  };
});

import { GET } from "@/app/api/health/route";

const call = () =>
  GET(new Request("http://localhost/api/health"), {
    params: Promise.resolve({}),
  });

beforeAll(ensureTestTable);
beforeEach(() => {
  dynamo.override = undefined;
  vi.mocked(auth).mockReset();
});

describe("GET /api/health", () => {
  it("returns 200 ok with no session and never calls auth()", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await call();
    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
    const body = HealthResponseSchema.parse(await res.json());
    expect(body).toEqual({
      data: {
        status: "ok",
        dependencies: { dynamodb: "ok", litellm: "not-configured" },
      },
    });
  });

  it("sets Cache-Control: private, no-store", async () => {
    const res = await call();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns 200 degraded when DynamoDB is unreachable", async () => {
    dynamo.override = "unreachable";
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.data.status).toBe("degraded");
    expect(body.data.dependencies.dynamodb).toBe("unreachable");
  });

  it.each([undefined, "unreachable" as const])(
    "never leaks the table name, endpoint, or an error message (override=%s)",
    async (override) => {
      dynamo.override = override;
      const text = await (await call()).text();
      expect(text).not.toContain(TEST_TABLE_NAME);
      expect(text).not.toContain("bedrock-usage");
      expect(text).not.toMatch(/localhost|127\.0\.0\.1|:8000|amazonaws/i);
      expect(text).not.toMatch(/error|stack|exception/i);
      expect(JSON.parse(text)).not.toHaveProperty("error");
    },
  );

  it("exports GET only (no write method)", async () => {
    const mod: Record<string, unknown> = await import("@/app/api/health/route");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(mod[method]).toBeUndefined();
    }
  });
});
