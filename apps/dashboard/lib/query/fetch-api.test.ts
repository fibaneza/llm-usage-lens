import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiRequestError, fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: Phase 3.3 contract — TanStack Query client; Rule 20.11 (response
// shape validated on both ends); Rule 60.24 (stubbed fetch, no real network).
const schema = z.object({ n: z.number() });

function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn<typeof fetch>(async () => Response.json(body, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchApi", () => {
  it("returns the parsed data of a { data } body", async () => {
    const fn = stubFetch({ data: { n: 3 } });
    await expect(fetchApi("/api/x?a=1", schema)).resolves.toEqual({ n: 3 });
    expect(String(fn.mock.calls[0]?.[0])).toBe("/api/x?a=1");
  });

  it("throws ApiRequestError(status, code, message) on an { error } body", async () => {
    stubFetch({ error: { code: "NOT_FOUND", message: "gone" } }, 404);
    const err = await fetchApi("/api/x", schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      message: "gone",
    });
  });

  it("rejects when data does not match the data schema", async () => {
    stubFetch({ data: { n: "nope" } });
    await expect(fetchApi("/api/x", schema)).rejects.toThrow();
  });

  it.each([
    ["a bare array", [1, 2]],
    ["a { result } shape", { result: { n: 1 } }],
    ["a string error", { error: "boom" }],
  ])("rejects a malformed body: %s", async (_n, body) => {
    stubFetch(body);
    await expect(fetchApi("/api/x", schema)).rejects.toThrow();
  });

  it("rejects a non-JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 502 })),
    );
    await expect(fetchApi("/api/x", schema)).rejects.toThrow();
  });
});

describe("mutateApi", () => {
  // Source: Access Control spec — Enforcement item 6: a write body must be
  // application/json, else the server answers 400.
  it("sends Content-Type: application/json with a JSON body", async () => {
    const fn = stubFetch({ data: { n: 1 } });
    await mutateApi("/api/x", "POST", { a: 1 }, schema);
    const init = fn.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(init?.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("sends no body (and no content type) for an undefined body", async () => {
    const fn = stubFetch({ data: { n: 1 } });
    await mutateApi("/api/x", "DELETE", undefined, schema);
    expect(fn.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
});

// Unit BP, Platform spec - Base path: BP-D3 (fetch-api.ts is the one chokepoint
// that prefixes "/api/..." literals) and BP-D13 (BASE_PATH read at load).
// Test T3 of the BP brief; the empty prefix is covered by the cases above.
describe("fetchApi and mutateApi under a base path (BP-D3)", () => {
  async function loadPrefixed() {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/llm-lens");
    return import("@/lib/query/fetch-api");
  }

  it("fetchApi requests the prefixed URL and keeps the query string", async () => {
    const fn = stubFetch({ data: { n: 1 } });
    const mod = await loadPrefixed();
    await mod.fetchApi("/api/x?a=1", schema);
    expect(String(fn.mock.calls[0]?.[0])).toBe("/llm-lens/api/x?a=1");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "mutateApi %s requests the prefixed URL",
    async (method) => {
      const fn = stubFetch({ data: { n: 1 } });
      const mod = await loadPrefixed();
      await mod.mutateApi("/api/x", method, { a: 1 }, schema);
      expect(String(fn.mock.calls[0]?.[0])).toBe("/llm-lens/api/x");
      expect(fn.mock.calls[0]?.[1]).toMatchObject({ method });
    },
  );

  it("does not double a path that already carries the prefix", async () => {
    const fn = stubFetch({ data: { n: 1 } });
    const mod = await loadPrefixed();
    await mod.fetchApi("/llm-lens/api/x", schema);
    expect(String(fn.mock.calls[0]?.[0])).toBe("/llm-lens/api/x");
  });

  it("mutateApi with no prefix keeps the plain URL", async () => {
    const fn = stubFetch({ data: { n: 1 } });
    await mutateApi("/api/x", "POST", undefined, schema);
    expect(String(fn.mock.calls[0]?.[0])).toBe("/api/x");
  });
});
