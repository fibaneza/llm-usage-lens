import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: () => auth() }));

import { INTERNAL_ADMIN_ROLE } from "@/lib/auth/roles";
import {
  BadRequestError,
  NotFoundError,
  jsonData,
  jsonError,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";

// Source: docs/specs/2026-11-10-access-control.md — Enforcement item 4
// (Cache-Control: private, no-store on every /api/* response) and item 6
// (write same-origin check after 401/403, before input parsing; JSON content
// type on write bodies); Rule 10.3, 50.4, 60.23. Security review 2026-11-11.

const ctx = { params: Promise.resolve({}) };
const NO_STORE = "private, no-store";
const ADMIN = {
  user: { oid: "oid-test", name: "a", roles: [INTERNAL_ADMIN_ROLE] },
};
const VIEWER = {
  user: { oid: "oid-test", name: "v", roles: ["internal-viewer"] },
};
const HOST = "app.example.test";
const URL_ = `http://${HOST}/api/x`;

type Init = {
  method?: string;
  origin?: string | null;
  host?: string | null;
  forwardedHost?: string;
  contentType?: string | null;
  body?: string;
  url?: string;
};

function request({
  method = "POST",
  origin = `http://${HOST}`,
  host = HOST,
  forwardedHost,
  contentType = "application/json",
  body,
  url = URL_,
}: Init = {}) {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (host !== null) headers.set("host", host);
  if (forwardedHost) headers.set("x-forwarded-host", forwardedHost);
  if (contentType !== null) headers.set("content-type", contentType);
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    ...(hasBody ? { body: body ?? "{}" } : {}),
  });
}

beforeEach(() => {
  auth.mockReset();
  auth.mockResolvedValue(ADMIN);
});

describe("Cache-Control: private, no-store (L2)", () => {
  it("jsonData sets it", () => {
    expect(jsonData({ a: 1 }).headers.get("cache-control")).toBe(NO_STORE);
  });

  it("jsonData keeps other ResponseInit headers alongside it", () => {
    const res = jsonData(1, { headers: { "x-test": "y" } });
    expect(res.headers.get("x-test")).toBe("y");
    expect(res.headers.get("cache-control")).toBe(NO_STORE);
  });

  it.each([
    [400, "BAD_REQUEST"],
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [500, "INTERNAL"],
  ] as const)("jsonError %i sets it", (status, code) => {
    expect(jsonError(status, code, "m").headers.get("cache-control")).toBe(
      NO_STORE,
    );
  });

  describe("every outcome of withRoute", () => {
    const get = () => request({ method: "GET", origin: null });

    it("200", async () => {
      const res = await withRoute(async () => jsonData(1))(get(), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe(NO_STORE);
    });

    it("400", async () => {
      const res = await withRoute(async () => {
        throw new BadRequestError([]);
      })(get(), ctx);
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe(NO_STORE);
    });

    it("401", async () => {
      auth.mockResolvedValue(null);
      const res = await withRoute(async () => jsonData(1))(get(), ctx);
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe(NO_STORE);
    });

    it("403 (role)", async () => {
      auth.mockResolvedValue(VIEWER);
      const res = await withRoute(async () => jsonData(1), {
        requireAdmin: true,
      })(request(), ctx);
      expect(res.status).toBe(403);
      expect(res.headers.get("cache-control")).toBe(NO_STORE);
    });

    it("403 (origin)", async () => {
      const res = await withRoute(async () => jsonData(1))(
        request({ origin: null }),
        ctx,
      );
      expect(res.status).toBe(403);
      expect(res.headers.get("cache-control")).toBe(NO_STORE);
    });

    it("404", async () => {
      const res = await withRoute(async () => {
        throw new NotFoundError("x");
      })(get(), ctx);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe(NO_STORE);
    });

    it("500", async () => {
      const res = await withRoute(async () => {
        throw new Error("boom");
      })(get(), ctx);
      expect(res.status).toBe(500);
      expect(res.headers.get("cache-control")).toBe(NO_STORE);
    });
  });
});

describe("403 message names the role constant (L4)", () => {
  it("requireAdmin 403 says `internal-admin role required`", async () => {
    auth.mockResolvedValue(VIEWER);
    const res = await withRoute(async () => jsonData(1), {
      requireAdmin: true,
    })(request(), ctx);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: "internal-admin role required" },
    });
  });
});

describe("write same-origin check (M2)", () => {
  const handlerFor = () => vi.fn(async () => jsonData({ ran: true }));

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "%s with the same-origin Origin runs the handler",
    async (method) => {
      const handler = handlerFor();
      const res = await withRoute(handler)(request({ method }), ctx);
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledOnce();
    },
  );

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "%s without Origin is 403 FORBIDDEN and never reaches the handler",
    async (method) => {
      const handler = handlerFor();
      const res = await withRoute(handler)(
        request({ method, origin: null }),
        ctx,
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toEqual({
        error: { code: "FORBIDDEN", message: expect.any(String) },
      });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a different host", "https://evil.example.test"],
    ["the same host on a different port", `http://${HOST}:8443`],
    ["the literal null origin", "null"],
    ["an unparsable origin", "not a url"],
    ["an empty origin", ""],
  ])("an Origin that is %s is 403 FORBIDDEN", async (_name, origin) => {
    const handler = handlerFor();
    const res = await withRoute(handler)(request({ origin }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
    expect(handler).not.toHaveBeenCalled();
  });

  it("matches the Origin host to the Host header including the port", async () => {
    const handler = handlerFor();
    const res = await withRoute(handler)(
      request({ origin: "http://localhost:3000", host: "localhost:3000" }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not trust x-forwarded-host", async () => {
    const handler = handlerFor();
    const res = await withRoute(handler)(
      request({
        origin: "https://evil.example.test",
        host: HOST,
        forwardedHost: "evil.example.test",
      }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("falls back to the request URL host when there is no Host header", async () => {
    const handler = handlerFor();
    const ok = await withRoute(handler)(
      request({
        host: null,
        origin: "http://url-host.example.test",
        url: "http://url-host.example.test/api/x",
      }),
      ctx,
    );
    expect(ok.status).toBe(200);
    const bad = await withRoute(handler)(
      request({
        host: null,
        origin: "http://other.example.test",
        url: "http://url-host.example.test/api/x",
      }),
      ctx,
    );
    expect(bad.status).toBe(403);
    expect(handler).toHaveBeenCalledOnce();
  });

  it.each(["GET", "HEAD"])("%s needs no Origin", async (method) => {
    const handler = handlerFor();
    const res = await withRoute(handler)(
      request({ method, origin: null }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("GET with a cross-site Origin still runs (reads are not checked)", async () => {
    const handler = handlerFor();
    const res = await withRoute(handler)(
      request({ method: "GET", origin: "https://evil.example.test" }),
      ctx,
    );
    expect(res.status).toBe(200);
  });

  describe("order of checks", () => {
    it("unauthenticated write with a bad Origin is 401", async () => {
      auth.mockResolvedValue(null);
      const res = await withRoute(handlerFor(), { requireAdmin: true })(
        request({ origin: "https://evil.example.test" }),
        ctx,
      );
      expect(res.status).toBe(401);
    });

    it("non-admin with a bad Origin on a requireAdmin route is 403 with the permission message", async () => {
      auth.mockResolvedValue(VIEWER);
      const res = await withRoute(handlerFor(), { requireAdmin: true })(
        request({ origin: "https://evil.example.test" }),
        ctx,
      );
      expect(res.status).toBe(403);
      expect((await res.json()).error.message).toBe(
        "internal-admin role required",
      );
    });

    it("admin with a bad Origin is 403", async () => {
      const res = await withRoute(handlerFor(), { requireAdmin: true })(
        request({ origin: "https://evil.example.test" }),
        ctx,
      );
      expect(res.status).toBe(403);
    });

    it("admin with a good Origin and an invalid body is 400", async () => {
      const handler = withRoute(
        async (r) => {
          await parseJsonBody(r, z.object({ name: z.string() }));
          return jsonData(1);
        },
        { requireAdmin: true },
      );
      const res = await handler(request({ body: "{}" }), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("BAD_REQUEST");
    });

    it("the origin check comes before the body is parsed (cross-site + bad body is 403, not 400)", async () => {
      const handler = withRoute(async (r) => {
        await parseJsonBody(r, z.object({ name: z.string() }));
        return jsonData(1);
      });
      const res = await handler(
        request({ origin: "https://evil.example.test", body: "{not json" }),
        ctx,
      );
      expect(res.status).toBe(403);
    });
  });
});

describe("parseJsonBody content type (M2)", () => {
  const schema = z.object({ n: z.number() });
  const body = JSON.stringify({ n: 1 });
  const post = (contentType: string | null) => request({ contentType, body });

  it.each([
    "application/json",
    "application/json; charset=utf-8",
    "APPLICATION/JSON",
    "Application/Json;charset=UTF-8",
  ])("accepts %s", async (contentType) => {
    await expect(parseJsonBody(post(contentType), schema)).resolves.toEqual({
      n: 1,
    });
  });

  it.each([
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/jsonp",
    "text/json",
  ])("rejects %s with BadRequestError", async (contentType) => {
    await expect(
      parseJsonBody(post(contentType), schema),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects a missing Content-Type with BadRequestError", async () => {
    // A string body makes the platform default to text/plain, so remove it.
    const req = post(null);
    req.headers.delete("content-type");
    await expect(parseJsonBody(req, schema)).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("maps a non-JSON content type to 400 BAD_REQUEST through withRoute", async () => {
    const res = await withRoute(async (r) => {
      await parseJsonBody(r, schema);
      return jsonData(1);
    })(post("text/plain"), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("maps a missing content type to 400 BAD_REQUEST through withRoute", async () => {
    const req = post(null);
    req.headers.delete("content-type");
    const res = await withRoute(async (r) => {
      await parseJsonBody(r, schema);
      return jsonData(1);
    })(req, ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });
});
