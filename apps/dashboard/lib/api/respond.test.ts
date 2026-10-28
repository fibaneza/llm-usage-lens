import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));

import {
  NotFoundError,
  jsonData,
  jsonError,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes"; Rule 10.3,
// Rule 50.4 (401 before any data access), Rule 50.6 (no internals leaked),
// Rule 60.18 (no console.log).

const req = (url = "http://localhost/api/x") => new Request(url);
const SESSION = { user: { name: "t" } };

beforeEach(() => {
  auth.mockReset();
});

describe("jsonData", () => {
  it("returns 200 { data }", async () => {
    const res = jsonData({ a: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { a: 1 } });
  });

  it("wraps null as { data: null } (never a bare value)", async () => {
    expect(await jsonData(null).json()).toEqual({ data: null });
  });

  it("honours ResponseInit headers", () => {
    const res = jsonData(1, { headers: { "x-test": "y" } });
    expect(res.headers.get("x-test")).toBe("y");
  });
});

describe("jsonError", () => {
  it.each([
    [400, "BAD_REQUEST"],
    [401, "UNAUTHORIZED"],
    [404, "NOT_FOUND"],
    [500, "INTERNAL"],
  ] as const)(
    "returns %i { error: { code, message } }",
    async (status, code) => {
      const res = jsonError(status, code, "msg");
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: { code, message: "msg" } });
    },
  );
});

describe("parseSearchParams", () => {
  const schema = z.object({ limit: z.coerce.number() });

  it("parses the query string through the schema", () => {
    expect(
      parseSearchParams(req("http://localhost/x?limit=5"), schema),
    ).toEqual({
      limit: 5,
    });
  });

  it("throws ZodError on invalid input", () => {
    expect(() =>
      parseSearchParams(req("http://localhost/x?limit=abc"), schema),
    ).toThrow(z.ZodError);
  });
});

describe("withRoute", () => {
  it("returns 401 UNAUTHORIZED without calling the handler when there is no session", async () => {
    auth.mockResolvedValue(null);
    const handler = vi.fn(async () => jsonData("secret"));
    const res = await withRoute(handler)(req(), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "UNAUTHORIZED", message: expect.any(String) },
    });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the response of the handler through when authenticated", async () => {
    auth.mockResolvedValue(SESSION);
    const handler = vi.fn(async () => jsonData({ ok: true }));
    const res = await withRoute(handler)(req(), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("maps request-input parse failures (parseSearchParams) to 400 BAD_REQUEST with the first issue", async () => {
    auth.mockResolvedValue(SESSION);
    const handler = async (request: Request) => {
      parseSearchParams(request, z.object({ n: z.coerce.number().int() }));
      return jsonData(1);
    };
    const res = await withRoute(handler)(req("http://localhost/x?n=abc"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("maps any ZodError not from input parsing to 500 INTERNAL with a generic message", async () => {
    auth.mockResolvedValue(SESSION);
    const handler = async () => {
      z.object({ secretField: z.string() }).parse({});
      return jsonData(1);
    };
    const res = await withRoute(handler)(req(), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("secretField");
  });

  it("maps NotFoundError to 404 NOT_FOUND", async () => {
    auth.mockResolvedValue(SESSION);
    const res = await withRoute(async () => {
      throw new NotFoundError("department x not found");
    })(req(), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("maps unknown errors to 500 INTERNAL with a generic message that does not echo the error", async () => {
    auth.mockResolvedValue(SESSION);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await withRoute(async () => {
      throw new Error("AKIA-secret-connection-string");
    })(req(), { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("AKIA-secret");
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("forwards the dynamic params promise to the handler", async () => {
    auth.mockResolvedValue(SESSION);
    const res = await withRoute(async (_r, ctx) => {
      const { id } = (await ctx.params) as { id: string };
      return jsonData({ id });
    })(req(), { params: Promise.resolve({ id: "eng" }) });
    expect(await res.json()).toEqual({ data: { id: "eng" } });
  });
});

describe("withRoute server-side failures", () => {
  it("returns a 500 INTERNAL body when auth() throws", async () => {
    auth.mockRejectedValue(new Error("jwt secret missing"));
    const handler = withRoute(async () => jsonData(1));
    const res = await handler(req(), { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("jwt");
  });
});
