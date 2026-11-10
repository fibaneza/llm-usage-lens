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

// Signed in, but not an Admin: every shape a non-admin session can take.
const NON_ADMIN_SESSIONS: [string, unknown][] = [
  ["no roles claim (token from before roles existed)", { user: { name: "M" } }],
  ["an empty roles list", { user: { name: "M", roles: [] } }],
  ["other roles only", { user: { name: "M", roles: ["Reader", "Auditor"] } }],
  ["the role in the wrong case", { user: { name: "M", roles: ["admin"] } }],
  ["a role that merely contains Admin", { user: { roles: ["SuperAdmin"] } }],
  ["roles that is a string, not a list", { user: { roles: "Admin" } }],
  // Phase 4R.1: only effective internal-admin may write (Access Control
  // spec — Permission matrix; contract R1 decision 10).
  ["internal-auditor", { user: { name: "M", roles: ["internal-auditor"] } }],
  [
    "internal-org-admin",
    { user: { name: "M", roles: ["internal-org-admin"] } },
  ],
  ["internal-viewer", { user: { name: "M", roles: ["internal-viewer"] } }],
  [
    "internal-auditor and internal-org-admin together",
    { user: { roles: ["internal-auditor", "internal-org-admin"] } },
  ],
];

// Bodies an ungated handler would reject with 400 (or accept): the gate must
// answer first either way.
const BODIES: [string, string][] = [
  ["a body that is not JSON", "{not json"],
  ["an empty object", "{}"],
];

function call(
  route: WriteRoute,
  body: string | undefined,
  params: WriteRoute["params"] = route.params,
) {
  return route.handler(
    new Request(`http://localhost${route.path}`, {
      method: route.method,
      headers: { "content-type": "application/json" },
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

const eachWriteRoute = writeRoutes.map(
  (route) => [label(route), route] as const,
);

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
        return jsonError(403, "FORBIDDEN", "Admin role required");
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

  it("rejects a route that writes to the table before it answers 403", async () => {
    await expect(
      expectForbiddenWithoutTouchingTheTable(writesBeforeForbidding),
    ).rejects.toThrow(/deeply equal/);
  });
});
