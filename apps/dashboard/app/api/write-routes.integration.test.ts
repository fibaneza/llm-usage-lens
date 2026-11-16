import { readdirSync } from "node:fs";
import { join, sep } from "node:path";

import { ApiErrorBodySchema, ApiErrorCodeSchema } from "@llm-usage-lens/shared";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import {
  jsonData,
  jsonError,
  withRoute,
  type RouteContext,
} from "@/lib/api/respond";
import { ROUTE_REGISTRY } from "@/test/route-registry";
import { NON_ADMIN_SESSIONS } from "@/test/route-sessions";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
  putRaw,
  testDoc,
} from "@/test/test-support";

// Source: docs/specs/2026-05-15-system-architecture.md — "Authentication &
// Access" → "Account-mutation role": every write Route Handler
// (POST/PUT/PATCH/DELETE) under /api, except Auth.js's own
// /api/auth/[...nextauth] handler, requires the Admin role, "and a structural
// test enumerates them so a new write route cannot ship ungated"; the role is
// checked after the session check and before
// input parsing or any DynamoDB call, so a signed-in non-admin always gets
// 403 FORBIDDEN (never 400/404). Rule 10.3; Rule 50.4; implementation-phases —
// Phase 3.3 amendment, "Hardening". Only `@/auth` is mocked (and `next/cache`,
// which throws outside a Next.js request); the routes run against DynamoDB
// Local, so nothing here can reach AWS (Rule 60.22).
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const API_DIR = __dirname;
const APP_DIR = join(API_DIR, "..");
// The only route file exempt from the gate: Auth.js's own sign-in handler.
const AUTH_JS_HANDLER = "auth/[...nextauth]/route.ts";
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
type WriteMethod = (typeof WRITE_METHODS)[number];

type RouteHandler = (request: Request, ctx: RouteContext) => Promise<Response>;
type WriteRoute = {
  // Path of the route file relative to app/api, always with "/" separators.
  file: string;
  method: WriteMethod;
  handler: RouteHandler;
  // Request path with dynamic segments filled in, and the matching params.
  path: string;
  params: Record<string, string | string[]>;
};

// Every route file under `dir`, relative to it and with "/" separators.
function listRouteFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.split(sep).join("/"))
    .filter((entry) => /(^|\/)route\.(ts|tsx|js|jsx|mjs)$/.test(entry))
    .sort();
}

// `[id]` -> { id }; `[...slug]` and `[[...slug]]` -> { slug: [...] } (a
// catch-all param is a string[] in Next.js). The values are deliberately not
// valid ids: an ungated handler would answer 400/404.
function dummyRouteParts(file: string) {
  const params: Record<string, string | string[]> = {};
  const segments = file
    .split("/")
    .slice(0, -1)
    .map((segment) => {
      const catchAll = /^\[\[?\.\.\.([\w-]+)\]\]?$/.exec(segment);
      if (catchAll?.[1]) {
        params[catchAll[1]] = ["not-an-id"];
        return "not-an-id";
      }
      const dynamic = /^\[([\w-]+)\]$/.exec(segment);
      if (dynamic?.[1]) {
        params[dynamic[1]] = "not-an-id";
        return "not-an-id";
      }
      return segment;
    });
  return {
    path: `/api${segments.map((segment) => `/${segment}`).join("")}`,
    params,
  };
}

async function loadWriteRoutes(files: string[]): Promise<WriteRoute[]> {
  const routes: WriteRoute[] = [];
  for (const file of files) {
    const mod: Record<string, unknown> = await import(
      /* @vite-ignore */ join(API_DIR, file)
    );
    for (const method of WRITE_METHODS) {
      const handler = mod[method];
      if (handler === undefined) continue;
      if (typeof handler !== "function") {
        throw new Error(`${file} exports ${method} but it is not a function`);
      }
      routes.push({
        file,
        method,
        handler: handler as RouteHandler,
        ...dummyRouteParts(file),
      });
    }
  }
  return routes;
}

const allApiRouteFiles = listRouteFiles(API_DIR);
const routeFiles = allApiRouteFiles.filter((file) => file !== AUTH_JS_HANDLER);
const writeRoutes = await loadWriteRoutes(routeFiles);
const label = (route: WriteRoute) => `${route.method} ${route.file}`;

function setSession(session: unknown) {
  vi.mocked(auth).mockResolvedValue(session as never);
}

// Bodies an ungated handler would reject with 400 (or accept): the gate must
// answer first either way.
const BODIES: [string, string][] = [
  ["a body that is not JSON", "{not json"],
  ["an empty object", "{}"],
];

// Same-origin by default (Access Control spec — Enforcement item 6): Origin's
// host equals the Host header. `origin: null` omits the header. The host header
// is set explicitly because a Node `Request` has none; the implementation
// reads `request.headers.get("host")`, falling back to `new URL(request.url).host`.
const HOST = "localhost:3000";
const SAME_ORIGIN = `http://${HOST}`;

function call(
  route: WriteRoute,
  body: string | undefined,
  params: WriteRoute["params"] = route.params,
  origin: string | null = SAME_ORIGIN,
) {
  return route.handler(
    new Request(`http://${HOST}${route.path}`, {
      method: route.method,
      headers: {
        "content-type": "application/json",
        host: HOST,
        ...(origin === null ? {} : { origin }),
      },
      body,
    }),
    // RouteContext types every param as a string; Next.js passes string[] for
    // catch-all segments, which the dummy params mirror.
    { params: Promise.resolve(params) } as unknown as RouteContext,
  );
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const raw = await res.json();
  const parsed = ApiErrorBodySchema.parse(raw);
  expect(ApiErrorCodeSchema.parse(parsed.error.code)).toBe(code);
  expect(raw.data).toBeUndefined();
}

async function snapshotTable(): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await testDoc().send(
      new ScanCommand({
        TableName: TEST_TABLE_NAME,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items.sort((a, b) =>
    `${String(a.PK)}|${String(a.SK)}`.localeCompare(
      `${String(b.PK)}|${String(b.SK)}`,
    ),
  );
}

const existing = makeAccount(1);

// The three checks the structural test applies to every write route. They are
// plain functions so the self-test below can prove each one catches a bad route.
async function expectForbiddenForEveryNonAdmin(route: WriteRoute) {
  for (const [sessionName, session] of NON_ADMIN_SESSIONS) {
    for (const [bodyName, body] of BODIES) {
      setSession(session);
      const res = await call(route, body);
      expect(
        res.status,
        `${label(route)} signed in with ${sessionName}, sent ${bodyName}`,
      ).toBe(403);
      await expectError(res, 403, "FORBIDDEN");
    }
  }
}

// The id of a real account and a body that would be a valid PATCH: had the
// handler run, it would have changed the stored account.
async function expectForbiddenWithoutTouchingTheTable(route: WriteRoute) {
  const before = await snapshotTable();
  expect(before.length).toBeGreaterThan(0);
  const realParams = Object.fromEntries(
    Object.entries(route.params).map(([name, value]) => [
      name,
      Array.isArray(value) ? [existing.accountId] : existing.accountId,
    ]),
  );
  for (const [, session] of NON_ADMIN_SESSIONS) {
    setSession(session);
    await expectError(
      await call(
        route,
        JSON.stringify({ accountName: "hijacked", active: false }),
        realParams,
      ),
      403,
      "FORBIDDEN",
    );
  }
  expect(await snapshotTable()).toEqual(before);
}

// A fresh sign-in time keeps the re-auth routes (Recent authentication, D28)
// from answering REAUTH_REQUIRED where a test means to pass the role and
// origin gates.
const ADMIN_SESSION = {
  user: {
    oid: "oid-test",
    name: "A",
    roles: ["internal-admin"],
    authTime: Math.floor(Date.now() / 1000),
  },
};
const CROSS_SITE_ORIGINS: [string, string | null][] = [
  ["no Origin header", null],
  ["a cross-site Origin", "https://evil.example.test"],
  ["the same host on another port", "http://localhost:4000"],
  ["a null Origin", "null"],
];

// An internal-admin session with a missing or foreign Origin must get 403
// before the handler parses the body or touches the table.
async function expectForbiddenForCrossSiteAdminWrites(route: WriteRoute) {
  const before = await snapshotTable();
  const realParams = Object.fromEntries(
    Object.entries(route.params).map(([name, value]) => [
      name,
      Array.isArray(value) ? [existing.accountId] : existing.accountId,
    ]),
  );
  for (const [originName, origin] of CROSS_SITE_ORIGINS) {
    for (const [bodyName, body] of [
      ...BODIES,
      ["a valid PATCH body", JSON.stringify({ accountName: "hijacked" })],
    ] as [string, string][]) {
      setSession(ADMIN_SESSION);
      const res = await call(route, body, realParams, origin);
      expect(
        res.status,
        `${label(route)} as internal-admin with ${originName}, sent ${bodyName}`,
      ).toBe(403);
      await expectError(res, 403, "FORBIDDEN");
    }
  }
  expect(await snapshotTable()).toEqual(before);
}

async function expectUnauthorizedWithoutSession(route: WriteRoute) {
  const before = await snapshotTable();
  for (const [, body] of BODIES) {
    setSession(null);
    await expectError(await call(route, body), 401, "UNAUTHORIZED");
  }
  expect(await snapshotTable()).toEqual(before);
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  setSession(null);
  await clearTable();
  await loadFixtures({ accounts: [existing] });
});

describe("write route discovery (the structural test is not vacuous)", () => {
  it("finds the route files under app/api", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
    expect(routeFiles).toEqual(
      expect.arrayContaining([
        "accounts/route.ts",
        "accounts/[id]/route.ts",
        "overview/route.ts",
      ]),
    );
  });

  it("exempts exactly Auth.js's own handler, auth/[...nextauth]/route.ts, and nothing else", () => {
    expect(allApiRouteFiles).toContain(AUTH_JS_HANDLER);
    expect(routeFiles).not.toContain(AUTH_JS_HANDLER);
    expect(allApiRouteFiles.filter((f) => !routeFiles.includes(f))).toEqual([
      AUTH_JS_HANDLER,
    ]);
  });

  // Route Handlers are only HTTP-reachable backend code under app/api (Rule
  // 10.3); a route.ts elsewhere under app/ would escape this enumeration.
  it("has no route file anywhere under app/ outside app/api", () => {
    const outside = listRouteFiles(APP_DIR).filter(
      (file) => !file.startsWith("api/"),
    );
    expect(outside).toEqual([]);
  });

  it("finds the three known account write handlers", () => {
    expect(writeRoutes.map(label)).toEqual(
      expect.arrayContaining([
        "POST accounts/route.ts",
        "PATCH accounts/[id]/route.ts",
        "DELETE accounts/[id]/route.ts",
      ]),
    );
  });

  it("finds only write methods (read handlers are not swept in)", () => {
    expect(writeRoutes.map((r) => r.method)).not.toContain("GET");
    expect(writeRoutes.map(label)).not.toContain("GET accounts/route.ts");
  });
});

// Access Control spec - "Enforcement" item 6: this test "enumerates every write
// route with its required permission". Every write method added by 4R.4 slice 1
// is listed here with the single role that may call it (T3, T4); a new write
// route under these paths that is not listed fails the check below.
// The list lives in the shared route registry (test/route-registry.ts, the
// single source of the route-contract suite); a write route that exists on
// disk but is not registered still fails the unlisted-method check below.
const ACCESS_CONTROL_WRITE_ROUTES = ROUTE_REGISTRY.filter(
  (e) => e.kind === "admin-write" && e.accessControl,
).map((e) => ({ label: e.key, permission: e.permission }));

describe("4R.4 slice 1 and 2 write routes are enumerated with their permission", () => {
  it("every listed method exists", () => {
    expect(writeRoutes.map(label)).toEqual(
      expect.arrayContaining(ACCESS_CONTROL_WRITE_ROUTES.map((r) => r.label)),
    );
  });

  it("the governance, group-mapping, role-grant and password-user routes expose no unlisted write method", () => {
    const listed = new Set<string>(
      ACCESS_CONTROL_WRITE_ROUTES.map((r) => r.label),
    );
    const found = writeRoutes
      .map(label)
      .filter((l) =>
        /(group-mappings|governance|role-grants|password-users)\//.test(l),
      );
    expect(found.filter((l) => !listed.has(l))).toEqual([]);
  });

  it.each(ACCESS_CONTROL_WRITE_ROUTES.map((r) => [r.label, r] as const))(
    "%s: only internal-admin passes the gate; auditor, org-admin and viewer get 403",
    async (name, entry) => {
      const route = writeRoutes.find((r) => label(r) === name);
      expect(route, `${name} must exist`).toBeDefined();
      expect(entry.permission).toBe("internal-admin");
      for (const roles of [
        ["internal-auditor"],
        ["internal-org-admin"],
        ["internal-viewer"],
      ]) {
        setSession({ user: { oid: "oid-test", roles } });
        await expectError(await call(route!, "{}"), 403, "FORBIDDEN");
      }
      setSession(ADMIN_SESSION);
      const res = await call(route!, "{}");
      expect([401, 403]).not.toContain(res.status);
    },
  );
});

// 4R.4 slice 4: the members, admin-scope, visibility and move writes are open to
// more than internal-admin (internal-org-admin and scoped internal-team-admin;
// Access Control spec - "Permission matrix"), so the admin-only sweeps below
// skip them; the block at the end of this file enumerates them with their own
// permission checks.
const MATRIX_WRITE_ROUTES: string[] = ROUTE_REGISTRY.filter(
  (e) => e.kind === "matrix-write",
).map((e) => e.key);

// 4R.5 step 5: the one write route that is not an admin or matrix write is a
// password user changing their own password (Access Control spec - "API routes
// (additions)": /api/account/password POST, "the signed-in password user").
// It has no role gate, so the admin-only sweeps skip it; the block at the end of
// this file enumerates it with its own gate, and account-password.integration
// .test.ts covers its behaviour.
const SELF_SERVICE_WRITE_ROUTES: string[] = ROUTE_REGISTRY.filter(
  (e) => e.kind === "self-write",
).map((e) => e.key);

const eachWriteRoute = writeRoutes
  .filter(
    (route) =>
      !MATRIX_WRITE_ROUTES.includes(label(route)) &&
      !SELF_SERVICE_WRITE_ROUTES.includes(label(route)),
  )
  .map((route) => [label(route), route] as const);

describe("every write route requires the Admin role", () => {
  it.each(eachWriteRoute)(
    "%s: a signed-in non-admin gets 403 FORBIDDEN, never 400/404, for every non-admin session and body",
    async (_label, route) => {
      await expectForbiddenForEveryNonAdmin(route);
    },
  );

  it.each(eachWriteRoute)(
    "%s: the 403 comes before any DynamoDB call (the table is untouched)",
    async (_label, route) => {
      await expectForbiddenWithoutTouchingTheTable(route);
    },
  );
});

// The session check still runs first and is unchanged (Rule 50.4): these hold
// before the hardening and guard a new write route against shipping with no
// session check at all.
describe("every write route requires a session", () => {
  it.each(eachWriteRoute)(
    "%s: no session gets 401 UNAUTHORIZED and the table is untouched",
    async (_label, route) => {
      await expectUnauthorizedWithoutSession(route);
    },
  );
});

// Access Control spec — Enforcement item 6 and item 4: same-origin check on
// every write, after the session (401) and permission (403) checks, before
// input parsing; every response is Cache-Control: private, no-store.
describe("every write route enforces the same-origin check", () => {
  it.each(eachWriteRoute)(
    "%s: an internal-admin write with no or a foreign Origin gets 403 FORBIDDEN and the table is untouched",
    async (_label, route) => {
      await expectForbiddenForCrossSiteAdminWrites(route);
    },
  );

  it.each(eachWriteRoute)(
    "%s: a same-origin internal-admin write is not stopped by the origin or role gate",
    async (_label, route) => {
      setSession(ADMIN_SESSION);
      const res = await call(route, "{}");
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    },
  );

  it.each(eachWriteRoute)(
    "%s: no session with a foreign Origin is still 401",
    async (_label, route) => {
      setSession(null);
      await expectError(
        await call(route, "{}", route.params, "https://evil.example.test"),
        401,
        "UNAUTHORIZED",
      );
    },
  );

  it.each(eachWriteRoute)(
    "%s: a non-admin with a foreign Origin gets the permission 403, naming internal-admin",
    async (_label, route) => {
      setSession({
        user: { oid: "oid-test", name: "M", roles: ["internal-viewer"] },
      });
      const res = await call(
        route,
        "{}",
        route.params,
        "https://evil.example.test",
      );
      expect(res.status).toBe(403);
      expect((await res.json()).error.message).toBe(
        "internal-admin role required",
      );
    },
  );

  it.each(eachWriteRoute)(
    "%s: 401, 403 and 400 responses carry Cache-Control: private, no-store",
    async (_label, route) => {
      setSession(null);
      expect((await call(route, "{}")).headers.get("cache-control")).toBe(
        "private, no-store",
      );
      setSession({ user: { oid: "oid-test", name: "M", roles: [] } });
      expect((await call(route, "{}")).headers.get("cache-control")).toBe(
        "private, no-store",
      );
      setSession(ADMIN_SESSION);
      expect(
        (await call(route, "{}", route.params, null)).headers.get(
          "cache-control",
        ),
      ).toBe("private, no-store");
    },
  );
});

// Negative controls: the checks above must fail for a route that is not gated,
// otherwise a green run proves nothing. Synthetic handlers stand in for a
// future route; they are not files under app/api.
describe("the structural checks catch a route that is not gated", () => {
  const synthetic = (
    handler: RouteHandler,
    method: WriteMethod = "POST",
  ): WriteRoute => ({
    file: "synthetic/route.ts",
    method,
    handler,
    path: "/api/synthetic",
    params: {},
  });

  const gated = synthetic(
    withRoute(async () => jsonData({ ok: true }), { requireAdmin: true }),
  );
  const sessionOnly = synthetic(withRoute(async () => jsonData({ ok: true })));
  const noSessionCheck = synthetic(async () =>
    Response.json({ data: { ok: true } }),
  );
  const writesBeforeForbidding = synthetic(
    withRoute(
      async () => {
        await putRaw({ PK: "ACCOUNT#999999999999", SK: "META", written: true });
        return jsonError(403, "FORBIDDEN", "internal-admin role required");
      },
      { requireAdmin: false },
    ),
  );

  it("fills dynamic segments with dummy values, including hyphenated names and catch-alls", () => {
    expect(dummyRouteParts("a/[id]/c-d/[team-id]/[...rest]/route.ts")).toEqual({
      path: "/api/a/not-an-id/c-d/not-an-id/not-an-id",
      params: {
        id: "not-an-id",
        "team-id": "not-an-id",
        rest: ["not-an-id"],
      },
    });
    expect(dummyRouteParts("a/[[...opt-slug]]/route.ts")).toEqual({
      path: "/api/a/not-an-id",
      params: { "opt-slug": ["not-an-id"] },
    });
    expect(dummyRouteParts("route.ts")).toEqual({ path: "/api", params: {} });
  });

  it("accepts a route wrapped with requireAdmin", async () => {
    await expectForbiddenForEveryNonAdmin(gated);
    await expectForbiddenWithoutTouchingTheTable(gated);
    await expectUnauthorizedWithoutSession(gated);
  });

  it("rejects a route that checks the session but not the role", async () => {
    await expect(expectForbiddenForEveryNonAdmin(sessionOnly)).rejects.toThrow(
      /to be 403/,
    );
  });

  it("rejects a route with no session check", async () => {
    await expect(
      expectUnauthorizedWithoutSession(noSessionCheck),
    ).rejects.toThrow(/to be 401/);
    await expect(
      expectForbiddenForEveryNonAdmin(noSessionCheck),
    ).rejects.toThrow(/to be 403/);
  });

  it("rejects a route that gates the role but not the origin", async () => {
    const noOriginCheck = synthetic(async (request, ctx) => {
      const session = await auth();
      if (!session) return jsonError(401, "UNAUTHORIZED", "Not authenticated");
      void request;
      void ctx;
      return jsonData({ ok: true });
    });
    await expect(
      expectForbiddenForCrossSiteAdminWrites(noOriginCheck),
    ).rejects.toThrow(/to be 403/);
    await expect(
      expectForbiddenForCrossSiteAdminWrites(gated),
    ).resolves.toBeUndefined();
  });

  it("rejects a route that writes to the table before it answers 403", async () => {
    await expect(
      expectForbiddenWithoutTouchingTheTable(writesBeforeForbidding),
    ).rejects.toThrow(/deeply equal/);
  });
});

// Access Control spec - "Recent authentication" (D28) and "API routes
// (additions)": the writes marked re-auth need a sign-in within 900 s, checked
// after the session, role and origin checks and before input parsing; every
// other write route is not gated by it. T30. F3 (run-r4b decisions, 2026-11-15)
// extends the list to the credential- and sign-in-affecting admin writes
// (password users, the password sign-in switch); PATCH, group mappings,
// memberships, visibility and links stay ungated.
const REAUTH_ROUTES: string[] = ROUTE_REGISTRY.filter((e) => e.reauth).map(
  (e) => e.key,
);

const STALE_ADMIN_SESSIONS: [string, unknown][] = [
  [
    "a stale authTime",
    {
      user: {
        oid: "oid-test",
        roles: ["internal-admin"],
        authTime: Math.floor(Date.now() / 1000) - 901,
      },
    },
  ],
  ["no authTime", { user: { oid: "oid-test", roles: ["internal-admin"] } }],
];

describe("recent-authentication routes are enumerated", () => {
  it("lists the re-auth routes, and they exist", () => {
    expect(writeRoutes.map(label)).toEqual(
      expect.arrayContaining([...REAUTH_ROUTES]),
    );
  });

  it.each(REAUTH_ROUTES.map((name) => [name] as const))(
    "%s: an internal-admin with a stale or missing authTime gets 403 REAUTH_REQUIRED, no-store, before parsing, and the table is untouched",
    async (name) => {
      const route = writeRoutes.find((r) => label(r) === name);
      expect(route, `${name} must exist`).toBeDefined();
      const before = await snapshotTable();
      for (const [sessionName, session] of STALE_ADMIN_SESSIONS) {
        for (const [bodyName, body] of BODIES) {
          setSession(session);
          const res = await call(route!, body);
          expect(
            res.headers.get("cache-control"),
            `${name} with ${sessionName}, sent ${bodyName}`,
          ).toBe("private, no-store");
          await expectError(res, 403, "REAUTH_REQUIRED");
        }
      }
      expect(await snapshotTable()).toEqual(before);
    },
  );

  it.each(REAUTH_ROUTES.map((name) => [name] as const))(
    "%s: the role and origin checks still come first (a stale non-admin and a stale cross-origin admin get FORBIDDEN)",
    async (name) => {
      const route = writeRoutes.find((r) => label(r) === name);
      expect(route, `${name} must exist`).toBeDefined();
      setSession({ user: { oid: "oid-test", roles: ["internal-viewer"] } });
      await expectError(await call(route!, "{}"), 403, "FORBIDDEN");
      setSession(STALE_ADMIN_SESSIONS[0]![1]);
      await expectError(
        await call(route!, "{}", route!.params, "https://evil.example.test"),
        403,
        "FORBIDDEN",
      );
    },
  );

  it("no other write route answers REAUTH_REQUIRED to an internal-admin with no authTime", async () => {
    const others = writeRoutes.filter(
      (route) => !REAUTH_ROUTES.includes(label(route)),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const route of others) {
      setSession({ user: { oid: "oid-test", roles: ["internal-admin"] } });
      const res = await call(route, "{}");
      const text = await res.text();
      expect(text, label(route)).not.toContain("REAUTH_REQUIRED");
    }
  });
});

// 4R.4 slice 4: the matrix write routes (Access Control spec - "Permission
// matrix", "Enforcement" items 2, 4, 6, T3). Unlike the admin-only routes above,
// internal-admin and internal-org-admin may call every one of them (a scoped
// internal-team-admin some of them, covered by the per-route suites), so the
// generic gate is: no session 401; no write permission at all 403 before
// parsing and before any DynamoDB call; a missing or foreign Origin 403 even for
// the permitted roles; and every response private, no-store.
describe("4R.4 slice 4 matrix write routes are enumerated", () => {
  it("every listed method exists", () => {
    expect(writeRoutes.map(label)).toEqual(
      expect.arrayContaining([...MATRIX_WRITE_ROUTES]),
    );
  });

  it("the team, department and affiliation routes expose no unlisted write method", () => {
    const listed = new Set<string>(MATRIX_WRITE_ROUTES);
    const found = writeRoutes
      .map(label)
      .filter((l) => /^[A-Z]+ (teams|departments|affiliations)\//.test(l));
    expect(found.filter((l) => !listed.has(l))).toEqual([]);
  });
});

const MATRIX_ROUTES = writeRoutes
  .filter((route) => MATRIX_WRITE_ROUTES.includes(label(route)))
  .map((route) => [label(route), route] as const);

// The sessions of NON_ADMIN_SESSIONS that hold no write permission anywhere:
// internal-org-admin may write the matrix routes.
const NON_WRITER_SESSIONS = NON_ADMIN_SESSIONS.filter(
  ([name]) => !name.includes("internal-org-admin"),
);
const MATRIX_WRITERS: [string, unknown][] = [
  ["internal-admin", ADMIN_SESSION],
  [
    "internal-org-admin",
    { user: { oid: "oid-test", name: "O", roles: ["internal-org-admin"] } },
  ],
];

// The first refusal per actor and action correctly writes a `denied` audit
// record (Access Control spec - Audit log, D17), so the "table untouched" checks
// of the matrix sweep compare everything except the AUDIT# rows.
async function snapshotWithoutAudit() {
  return (await snapshotTable()).filter(
    (item) => !String(item.PK).startsWith("AUDIT#"),
  );
}

describe("every matrix write route enforces session, permission and origin", () => {
  it.each(MATRIX_ROUTES)(
    "%s: no session gets 401 UNAUTHORIZED and the table is untouched",
    async (_label, route) => {
      await expectUnauthorizedWithoutSession(route);
    },
  );

  it.each(MATRIX_ROUTES)(
    "%s: a signed-in caller with no write permission gets 403 FORBIDDEN, never 400/404, for every body, before any DynamoDB call",
    async (name, route) => {
      const before = await snapshotWithoutAudit();
      const realParams = Object.fromEntries(
        Object.entries(route.params).map(([param, value]) => [
          param,
          Array.isArray(value) ? [existing.accountId] : existing.accountId,
        ]),
      );
      for (const [sessionName, session] of NON_WRITER_SESSIONS) {
        for (const [bodyName, body] of [
          ...BODIES,
          ["a plausible body", JSON.stringify({ oid: "someone", version: 1 })],
        ] as [string, string][]) {
          for (const params of [route.params, realParams]) {
            setSession(session);
            const res = await call(route, body, params);
            expect(
              res.status,
              `${name} signed in with ${sessionName}, sent ${bodyName}`,
            ).toBe(403);
            await expectError(res, 403, "FORBIDDEN");
          }
        }
      }
      expect(await snapshotWithoutAudit()).toEqual(before);
      // Denied records are asserted per route in the route suites: the
      // per-minute suppression (D17) makes them order-dependent in this sweep.
    },
  );

  it.each(MATRIX_ROUTES)(
    "%s: a permitted role with a missing or foreign Origin gets 403 FORBIDDEN before parsing, and the table is untouched",
    async (name, route) => {
      const before = await snapshotWithoutAudit();
      for (const [roleName, session] of MATRIX_WRITERS) {
        for (const [originName, origin] of CROSS_SITE_ORIGINS) {
          for (const [bodyName, body] of BODIES) {
            setSession(session);
            const res = await call(route, body, route.params, origin);
            expect(
              res.status,
              `${name} as ${roleName} with ${originName}, sent ${bodyName}`,
            ).toBe(403);
            await expectError(res, 403, "FORBIDDEN");
          }
        }
      }
      expect(await snapshotWithoutAudit()).toEqual(before);
    },
  );

  it.each(MATRIX_ROUTES)(
    "%s: a same-origin internal-admin or internal-org-admin write is not stopped by the session, role or origin gate",
    async (name, route) => {
      for (const [roleName, session] of MATRIX_WRITERS) {
        setSession(session);
        const res = await call(route, "{}");
        expect(res.status, `${name} as ${roleName}`).not.toBe(401);
        expect(res.status, `${name} as ${roleName}`).not.toBe(403);
      }
    },
  );

  it.each(MATRIX_ROUTES)(
    "%s: 401, 403 and 400 responses carry Cache-Control: private, no-store",
    async (_label, route) => {
      setSession(null);
      expect((await call(route, "{}")).headers.get("cache-control")).toBe(
        "private, no-store",
      );
      setSession({ user: { oid: "oid-test", name: "M", roles: [] } });
      expect((await call(route, "{}")).headers.get("cache-control")).toBe(
        "private, no-store",
      );
      setSession(ADMIN_SESSION);
      const res = await call(route, "{not json");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    },
  );
});

// Self-service write routes: no role, but the session must be a password user's
// own (authMethod "password"); Entra, master and dev-login sessions get 403
// FORBIDDEN even with the admin role, and the same-origin check applies to all.
describe("self-service write routes are enumerated and gated", () => {
  const SELF_ROUTES = writeRoutes
    .filter((route) => SELF_SERVICE_WRITE_ROUTES.includes(label(route)))
    .map((route) => [label(route), route] as const);

  const PASSWORD_SESSION = {
    user: {
      oid: "local:00000000-0000-4000-8000-000000000001",
      tid: "local",
      email: "alice@example.com",
      roles: [],
      authMethod: "password",
    },
  };

  it("every listed method exists", () => {
    expect(writeRoutes.map(label)).toEqual(
      expect.arrayContaining([...SELF_SERVICE_WRITE_ROUTES]),
    );
  });

  it("the account routes expose no unlisted write method", () => {
    const listed = new Set<string>(SELF_SERVICE_WRITE_ROUTES);
    const found = writeRoutes
      .map(label)
      .filter((l) => /^[A-Z]+ account\//.test(l));
    expect(found.filter((l) => !listed.has(l))).toEqual([]);
  });

  it.each(SELF_ROUTES)(
    "%s: no session gets 401 UNAUTHORIZED, even with a foreign Origin, and the table is untouched",
    async (_label, route) => {
      const before = await snapshotTable();
      setSession(null);
      await expectError(await call(route, "{}"), 401, "UNAUTHORIZED");
      await expectError(
        await call(
          route,
          "{not json",
          route.params,
          "https://evil.example.test",
        ),
        401,
        "UNAUTHORIZED",
      );
      expect(await snapshotTable()).toEqual(before);
    },
  );

  it.each(SELF_ROUTES)(
    "%s: a session that is not a password user's (any role, including internal-admin) gets 403 FORBIDDEN before parsing",
    async (_label, route) => {
      const sessions: unknown[] = [
        ...NON_ADMIN_SESSIONS.map(([, session]) => session),
        ADMIN_SESSION,
        {
          user: {
            oid: "oid-test",
            roles: ["internal-admin"],
            authMethod: "entra",
          },
        },
        {
          user: {
            oid: "master:",
            roles: ["internal-admin"],
            authMethod: "master",
          },
        },
        {
          user: {
            oid: "local:dev@localhost",
            roles: ["internal-admin"],
            authMethod: "local",
          },
        },
      ];
      for (const session of sessions) {
        for (const [, sent] of BODIES) {
          setSession(session);
          await expectError(await call(route, sent), 403, "FORBIDDEN");
        }
      }
    },
  );

  it.each(SELF_ROUTES)(
    "%s: a password user with a missing or foreign Origin gets 403 FORBIDDEN before parsing, and the table is untouched",
    async (_label, route) => {
      const before = await snapshotTable();
      for (const [, origin] of CROSS_SITE_ORIGINS) {
        for (const [, sent] of BODIES) {
          setSession(PASSWORD_SESSION);
          await expectError(
            await call(route, sent, route.params, origin),
            403,
            "FORBIDDEN",
          );
        }
      }
      expect(await snapshotTable()).toEqual(before);
    },
  );

  it.each(SELF_ROUTES)(
    "%s: a same-origin password user is not stopped by the session, role or origin gate, and a bad body is 400 BAD_REQUEST",
    async (_label, route) => {
      setSession(PASSWORD_SESSION);
      await expectError(await call(route, "{not json"), 400, "BAD_REQUEST");
      setSession(PASSWORD_SESSION);
      const res = await call(route, "{}");
      expect([401, 403]).not.toContain(res.status);
    },
  );

  it.each(SELF_ROUTES)(
    "%s: 401, 403 and 400 responses carry Cache-Control: private, no-store",
    async (_label, route) => {
      setSession(null);
      expect((await call(route, "{}")).headers.get("cache-control")).toBe(
        "private, no-store",
      );
      setSession(ADMIN_SESSION);
      expect((await call(route, "{}")).headers.get("cache-control")).toBe(
        "private, no-store",
      );
      setSession(PASSWORD_SESSION);
      expect(
        (await call(route, "{not json")).headers.get("cache-control"),
      ).toBe("private, no-store");
    },
  );
});

// LD24 / LT22 (docs/specs/2026-11-10-litellm.md): the only LiteLLM writes open
// to internal-org-admin are the operation toggles and the team links; the
// connection PUT and test stay internal-admin only, as does every other write
// outside the matrix list (Rule 10.3 exception; Rule 50.4). Unlike the matrix
// sweeps above, this block also refuses a team lead (internal-team-admin).
describe("LiteLLM writes: org-admin allowed on toggles and team links only (LD24, LT22)", () => {
  const ORG_ADMIN_WRITES = [
    "PUT litellm/toggles/route.ts",
    "PUT litellm/team-links/[teamId]/route.ts",
    "DELETE litellm/team-links/[teamId]/route.ts",
  ];
  const ADMIN_ONLY_LITELLM = [
    "PUT litellm/connection/route.ts",
    "POST litellm/connection/test/route.ts",
  ];
  const find = (name: string) => {
    const route = writeRoutes.find((r) => label(r) === name);
    expect(route, `${name} must exist`).toBeDefined();
    return route as WriteRoute;
  };
  const ORG_ADMIN_SESSION = {
    user: { oid: "oid-test", name: "O", roles: ["internal-org-admin"] },
  };
  const REFUSED_SESSIONS: [string, unknown][] = [
    [
      "internal-viewer",
      { user: { oid: "oid-test", roles: ["internal-viewer"] } },
    ],
    [
      "a team lead (internal-team-admin)",
      { user: { oid: "oid-test", roles: ["internal-team-admin"] } },
    ],
    ["no roles", { user: { oid: "oid-test" } }],
  ];

  it("the registry lists exactly these three as matrix writes and the connection pair as admin-only", () => {
    const kind = (name: string) =>
      ROUTE_REGISTRY.find((e) => e.key === name)?.kind;
    for (const name of ORG_ADMIN_WRITES)
      expect(kind(name)).toBe("matrix-write");
    for (const name of ADMIN_ONLY_LITELLM)
      expect(kind(name)).toBe("admin-write");
  });

  it.each(ORG_ADMIN_WRITES)(
    "%s: internal-admin and org-admin pass the role gate; viewer, team lead and no roles get 403 before parsing",
    async (name) => {
      const route = find(name);
      for (const session of [ADMIN_SESSION, ORG_ADMIN_SESSION]) {
        setSession(session);
        const res = await call(route, "{}");
        expect([401, 403]).not.toContain(res.status);
      }
      for (const [, session] of REFUSED_SESSIONS) {
        for (const [, body] of BODIES) {
          setSession(session);
          await expectError(await call(route, body), 403, "FORBIDDEN");
        }
      }
    },
  );

  it.each(ORG_ADMIN_WRITES)(
    "%s: a stored internal-org-admin RoleGrant without the claim passes the role gate (Rule 50.4)",
    async (name) => {
      const route = find(name);
      const { grantRole } = await import("@/lib/data/access/role-grants");
      const { ctxAt, ok } =
        await import("@/lib/data/access/access-test-support");
      ok(
        await grantRole(
          { oid: "oid-granted", role: "internal-org-admin", reason: "test" },
          ctxAt(),
        ),
      );
      setSession({ user: { oid: "oid-granted", roles: [] } });
      const res = await call(route, "{}");
      expect([401, 403]).not.toContain(res.status);
    },
  );

  it.each(ADMIN_ONLY_LITELLM)(
    "%s: an org-admin gets 403 FORBIDDEN naming internal-admin before parsing",
    async (name) => {
      const route = find(name);
      for (const [, body] of BODIES) {
        setSession(ORG_ADMIN_SESSION);
        const res = await call(route, body);
        await expectError(res, 403, "FORBIDDEN");
      }
      setSession(ORG_ADMIN_SESSION);
      const raw = await (await call(route, "{}")).json();
      expect(raw.error.message).toBe("internal-admin role required");
    },
  );
});
