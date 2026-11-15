import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/data/access/authorization", () => ({
  loadGrantedRoles: vi.fn(async () => []),
}));
const denied = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data/access/audit", () => ({ appendDeniedAudit: denied }));

import { withRoute } from "@/lib/api/respond";
import { INTERNAL_ADMIN_ROLE } from "@/lib/auth/roles";

// Source: docs/specs/2026-11-10-access-control.md — "Audit log" D17 (a write
// refused with 403 FORBIDDEN writes one `denied` record: actor, the operation
// the route serves, code, and `route: { method, pattern }` with the route's
// fixed pattern, never the raw path; response body, status and parity are
// unchanged; a failed record write never changes the response) and threat
// T22; Rule 50.4. Assumed API: withRoute(handler, { requireAdmin: true,
// denied: { action, pattern } }); the route supplies its fixed pattern and
// operation, the helper supplies actor (session oid), method and a
// server-generated requestId.
const ctx = { params: Promise.resolve({ id: "attacker-controlled" }) };
const HOST = "app.example.test";
const OID = "00000000-0000-4000-8000-000000000001";
const ADMIN = { user: { oid: OID, roles: [INTERNAL_ADMIN_ROLE] } };
const VIEWER = { user: { oid: OID, roles: ["internal-viewer"] } };
const OPTIONS = {
  requireAdmin: true,
  denied: { action: "account.update", pattern: "/api/accounts/[id]" },
} as const;

const request = (
  method = "PATCH",
  headers: Record<string, string> = {},
  path = "/api/accounts/attacker-controlled?x=secret",
) =>
  new Request(`http://${HOST}${path}`, {
    method,
    headers: {
      origin: `http://${HOST}`,
      host: HOST,
      "content-type": "application/json",
      ...headers,
    },
    body: "{}",
  });

beforeEach(() => {
  auth.mockReset();
  denied.mockReset().mockResolvedValue({ written: true });
});

describe("withRoute requireAdmin refusal writes a denied record (T22)", () => {
  it("writes one record with actor, action, FORBIDDEN, the fixed route pattern and the method", async () => {
    auth.mockResolvedValue(VIEWER);
    const handler = vi.fn();
    const res = await withRoute(handler, OPTIONS)(request(), ctx);
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect(denied).toHaveBeenCalledTimes(1);
    expect(denied.mock.calls[0]?.[0]).toMatchObject({
      actor: OID,
      action: "account.update",
      code: "FORBIDDEN",
      route: { method: "PATCH", pattern: "/api/accounts/[id]" },
    });
  });

  it("never records the raw path, query or params", async () => {
    auth.mockResolvedValue(VIEWER);
    await withRoute(vi.fn(), OPTIONS)(request(), ctx);
    const text = JSON.stringify(denied.mock.calls[0]?.[0]);
    expect(text).not.toContain("attacker-controlled");
    expect(text).not.toContain("secret");
  });

  it("uses the method of the request", async () => {
    auth.mockResolvedValue(VIEWER);
    await withRoute(vi.fn(), OPTIONS)(request("DELETE"), ctx);
    expect(denied.mock.calls[0]?.[0]).toMatchObject({
      route: { method: "DELETE" },
    });
  });

  it("leaves the response body, status and headers exactly as without a record", async () => {
    auth.mockResolvedValue(VIEWER);
    const res = await withRoute(vi.fn(), OPTIONS)(request(), ctx);
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: `${INTERNAL_ADMIN_ROLE} role required`,
      },
    });
  });

  it("generates the requestId on the server and ignores a client-supplied header", async () => {
    auth.mockResolvedValue(VIEWER);
    await withRoute(vi.fn(), OPTIONS)(
      request("PATCH", { "x-request-id": "client-chosen-id" }),
      ctx,
    );
    const { requestId } = denied.mock.calls[0]?.[0] as { requestId: string };
    expect(requestId).toEqual(expect.any(String));
    expect(requestId.length).toBeGreaterThan(0);
    expect(requestId).not.toBe("client-chosen-id");
  });

  it("returns the same 403 when the record write fails (written: false)", async () => {
    auth.mockResolvedValue(VIEWER);
    denied.mockResolvedValue({ written: false });
    const res = await withRoute(vi.fn(), OPTIONS)(request(), ctx);
    expect(res.status).toBe(403);
  });

  it("returns the same 403 when the record write rejects", async () => {
    auth.mockResolvedValue(VIEWER);
    denied.mockRejectedValue(new Error("table unavailable"));
    const res = await withRoute(vi.fn(), OPTIONS)(request(), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("awaits the record before the response (a separate PutItem before the response)", async () => {
    auth.mockResolvedValue(VIEWER);
    let finished = false;
    denied.mockImplementation(async () => {
      await Promise.resolve();
      finished = true;
      return { written: true };
    });
    await withRoute(vi.fn(), OPTIONS)(request(), ctx);
    expect(finished).toBe(true);
  });
});

describe("withRoute writes no denied record when the refusal is not an authorization refusal", () => {
  it("no record for an unauthenticated request (401)", async () => {
    auth.mockResolvedValue(null);
    const res = await withRoute(vi.fn(), OPTIONS)(request(), ctx);
    expect(res.status).toBe(401);
    expect(denied).not.toHaveBeenCalled();
  });

  it("no record when an admin is allowed through", async () => {
    auth.mockResolvedValue(ADMIN);
    const handler = vi.fn().mockResolvedValue(new Response("ok"));
    const res = await withRoute(handler, OPTIONS)(request(), ctx);
    expect(res.status).toBe(200);
    expect(denied).not.toHaveBeenCalled();
  });

  it("no record for a handler that throws a 400", async () => {
    auth.mockResolvedValue(ADMIN);
    const { BadRequestError } = await import("@/lib/api/respond");
    const res = await withRoute(async () => {
      throw new BadRequestError([]);
    }, OPTIONS)(request(), ctx);
    expect(res.status).toBe(400);
    expect(denied).not.toHaveBeenCalled();
  });

  it("a route without a denied option still answers 403 without touching the audit store", async () => {
    auth.mockResolvedValue(VIEWER);
    const res = await withRoute(vi.fn(), { requireAdmin: true })(
      request(),
      ctx,
    );
    expect(res.status).toBe(403);
    expect(denied).not.toHaveBeenCalled();
  });
});
