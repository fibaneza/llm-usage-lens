import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiRequestError, fetchApi } from "@/lib/query/fetch-api";

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
