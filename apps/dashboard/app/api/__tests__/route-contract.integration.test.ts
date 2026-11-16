import { readdirSync } from "node:fs";
import { join, sep } from "node:path";

import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetDeniedAudit } from "@/lib/data/access/audit";
import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import {
  SESSIONS,
  auditToday,
  deniedToday,
  expectData,
  expectError,
  expectNoStore,
  invoke,
  nonAuditItems,
} from "@/test/support/governance-route-support";
import { NON_ADMIN_SESSIONS } from "@/test/fixtures/route-sessions";
import { seedWorld } from "@/test/support/matrix-route-support";
import { resetFakeCache } from "@/test/fakes/next-cache-fake";
import {
  ROUTE_REGISTRY,
  type CallerName,
  type RouteEntry,
  type RouteMethod,
} from "@/test/route-registry";
import { rollups } from "@/test/fixtures/scope-fixtures";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  loadFixtures,
  testDoc,
} from "@/test/support/test-support";

// Source: Rule 60.23 (amended 2026-11-15: the cross-cutting route contract is
// asserted once, over a registry of every route), Rule 10.3, Rule 50.4, Rule
// 60.24a. Access Control spec (docs/specs/2026-11-10-access-control.md) -
// "Enforcement" item 2 (403 before parsing), item 4 (Cache-Control: private,
// no-store on every /api response), item 6 (same-origin writes), "Audit log"
// D17/T22 (one `denied` record per refused write, no raw path or body value),
// "Recent authentication" D28, "API routes" (every route needs a session except
// GET /api/health); LiteLLM spec - "Security architecture" LT1 (the service key
// never leaves the server). Only `@/auth` and `fetch` (the fake LiteLLM) are
// replaced: the routes, policy module and audit run on DynamoDB Local.
//
// Frozen entries (route or own test file frozen) get only today's sweep parity:
// checks 1, 2 (reduced bodies), 3 and 5; no check of theirs is new.
const h = vi.hoisted(() => {
  const KEY = "sk-contract-sentinel-0001";
  vi.stubEnv("LITELLM_SERVICE_KEY", KEY);
  vi.stubEnv("LITELLM_ALLOWED_HOSTS", "litellm.test:4000");
  return { authMock: vi.fn(), KEY };
});
vi.mock("@/auth", () => ({ auth: h.authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.fakeNextCache;
});

const API_DIR = join(__dirname, "..");
const AUTH_JS_HANDLER = "auth/[...nextauth]/route.ts";
const HEALTH = "health/route.ts";
const METHODS: RouteMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const FOREIGN = "https://evil.example.test";
const CROSS_SITE_ORIGINS: [string, string | null][] = [
  ["no Origin header", null],
  ["a cross-site Origin", FOREIGN],
  ["the same host on another port", "http://localhost:4000"],
  ["a null Origin", "null"],
];

type Handler = (
  request: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const routeFiles = readdirSync(API_DIR, { recursive: true, encoding: "utf8" })
  .map((entry) => entry.split(sep).join("/"))
  .filter((entry) => /(^|\/)route\.(ts|tsx|js|jsx|mjs)$/.test(entry))
  .filter((entry) => entry !== AUTH_JS_HANDLER)
  .sort();

const modules = new Map<string, Record<string, unknown>>();
for (const file of routeFiles) {
  modules.set(file, await import(/* @vite-ignore */ join(API_DIR, file)));
}

const diskKeys = routeFiles.flatMap((file) =>
  METHODS.filter((m) => typeof modules.get(file)?.[m] === "function").map(
    (m) => `${m} ${file}`,
  ),
);

function handlerOf(entry: RouteEntry): Handler {
  const handler = modules.get(entry.file)?.[entry.method];
  if (typeof handler !== "function") {
    throw new Error(`${entry.key} is registered but not exported`);
  }
  return handler as Handler;
}

const fill = (pattern: string, params: Record<string, string>) =>
  pattern.replace(/\[(\w+)\]/g, (_m, name: string) =>
    encodeURIComponent(params[name] ?? name),
  );

// Roles that hold no write permission anywhere (internal-org-admin may write
// the matrix routes).
const NON_WRITER_SESSIONS = NON_ADMIN_SESSIONS.filter(
  ([name]) => !name.includes("internal-org-admin"),
);

const OTHER_KINDS: Partial<Record<CallerName, unknown>> = {
  password: {
    user: {
      oid: "local:00000000-0000-4000-8000-000000000001",
      tid: "local",
      email: "alice@example.com",
      roles: [],
      authMethod: "password",
    },
  },
  entraAdmin: {
    user: { oid: "oid-entra", roles: ["internal-admin"], authMethod: "entra" },
  },
  masterAdmin: {
    user: { oid: "master:", roles: ["internal-admin"], authMethod: "master" },
  },
  localAdmin: {
    user: {
      oid: "local:dev@localhost",
      roles: ["internal-admin"],
      authMethod: "local",
    },
  },
};

type Session = { user: { oid: string; [key: string]: unknown } };
function sessionOf(name: CallerName): Session {
  const other = OTHER_KINDS[name];
  if (other) return other as Session;
  const base = SESSIONS[name as keyof typeof SESSIONS];
  return {
    user: {
      oid: base.oid,
      name: base.name,
      roles: [...base.roles],
      authTime: Math.floor(Date.now() / 1000),
    },
  };
}

function signIn(name: CallerName | null): void {
  h.authMock.mockResolvedValue(name === null ? null : sessionOf(name));
}
const signInRaw = (session: unknown) => h.authMock.mockResolvedValue(session);

async function fullSnapshot(): Promise<Record<string, unknown>[]> {
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

let fake: ReturnType<typeof createFakeLiteLLM>;

beforeAll(ensureTestTable);
beforeEach(async () => {
  fake = createFakeLiteLLM();
  vi.stubGlobal("fetch", fake.fetch);
  resetFakeCache();
  h.authMock.mockReset();
  h.authMock.mockResolvedValue(null);
  await clearTable();
  resetDeniedAudit();
  await seedWorld();
  await loadFixtures({ rollups: rollups() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function prepare(entry: RouteEntry): Promise<void> {
  await entry.seed?.();
}

type SendOptions = {
  params?: Record<string, string>;
  body?: unknown;
  origin?: string | null;
  contentType?: string | null;
  query?: string;
};

function send(entry: RouteEntry, o: SendOptions = {}): Promise<Response> {
  const params = o.params ?? entry.params.valid;
  const query = o.query ?? (entry.method === "GET" ? entry.query : undefined);
  return invoke(handlerOf(entry), {
    method: entry.method,
    path: `${fill(entry.pattern, params)}${query ? `?${query}` : ""}`,
    params,
    ...(entry.method === "GET" ? {} : { body: o.body }),
    ...(o.origin !== undefined ? { origin: o.origin } : {}),
    ...(o.contentType !== undefined ? { contentType: o.contentType } : {}),
  });
}

const noUpstreamCall = (entry: RouteEntry) => {
  if (entry.family === "litellm") expect(fake.calls).toEqual([]);
};

const writes = ROUTE_REGISTRY.filter((e) => e.method !== "GET");
const reads = ROUTE_REGISTRY.filter((e) => e.method === "GET");
const label = (e: RouteEntry) => e.key;

describe("registry parity with the route files on disk (check 7)", () => {
  it("registers exactly the exported methods of every route file under app/api, except Auth.js's handler (Rule 10.3)", () => {
    const registered = ROUTE_REGISTRY.map((e) => e.key).sort();
    expect(new Set(registered).size).toBe(registered.length);
    const unregistered = diskKeys.filter((k) => !registered.includes(k));
    const stale = registered.filter((k) => !diskKeys.includes(k));
    expect({ unregistered, stale }).toEqual({ unregistered: [], stale: [] });
  });

  it("never registers Auth.js's own handler (Rule 10.3 exemption)", () => {
    expect(ROUTE_REGISTRY.some((e) => e.file === AUTH_JS_HANDLER)).toBe(false);
  });

  it("derives each pattern and each kind consistently (a write is never a read entry)", () => {
    for (const e of ROUTE_REGISTRY) {
      expect(e.method === "GET", e.key).toBe(
        e.kind === "read" || e.kind === "public",
      );
      expect(Object.keys(e.params.valid).sort(), e.key).toEqual(
        Object.keys(e.params.invalid).sort(),
      );
    }
  });
});

describe("the public-route guard (Access Control spec - API routes; Rule 50.4)", () => {
  it("health/route.ts is the only route besides Auth.js's that answers a GET without a session", async () => {
    const open: string[] = [];
    for (const file of routeFiles) {
      const get = modules.get(file)?.GET;
      if (typeof get !== "function") continue;
      const params = Object.fromEntries(
        [...file.matchAll(/\[(\w+)\]/g)].map((m) => [m[1] ?? "", "not-an-id"]),
      );
      const res = await invoke(get, {
        method: "GET",
        path: `/api/${file}`,
        params,
      });
      if (res.status !== 401) open.push(file);
    }
    expect(open).toEqual([HEALTH]);
  });

  it("GET /api/health serves 200 with no session and Cache-Control: private, no-store (Enforcement item 4)", async () => {
    const entry = ROUTE_REGISTRY.find((e) => e.kind === "public");
    expect(entry?.file).toBe(HEALTH);
    if (!entry) return;
    const res = await send(entry);
    expect(res.status).toBe(200);
    expectNoStore(res);
  });
});

describe("1. no session answers 401 UNAUTHORIZED, no-store, and touches nothing (Rule 10.3, 50.4)", () => {
  it.each(
    ROUTE_REGISTRY.filter((e) => e.kind !== "public").map(
      (e) => [label(e), e] as const,
    ),
  )("%s", async (_name, entry) => {
    await prepare(entry);
    const before = await fullSnapshot();
    signIn(null);
    if (entry.method === "GET") {
      await expectError(await send(entry), 401, "UNAUTHORIZED");
    } else {
      await expectError(
        await send(entry, { body: entry.validBody }),
        401,
        "UNAUTHORIZED",
      );
      await expectError(
        await send(entry, {
          body: "{not json",
          params: entry.params.invalid,
          origin: FOREIGN,
        }),
        401,
        "UNAUTHORIZED",
      );
    }
    expect(await fullSnapshot()).toEqual(before);
    noUpstreamCall(entry);
  });
});

describe("2. a refused caller gets 403 before parsing or any table access (Enforcement items 2, 6; Rule 50.4)", () => {
  const adminWrites = writes.filter((e) => e.kind === "admin-write");

  it.each(adminWrites.map((e) => [label(e), e] as const))(
    "%s: every non-admin session and body, with a malformed or a real id, is 403 FORBIDDEN and the table is untouched",
    async (_name, entry) => {
      await prepare(entry);
      const before = await nonAuditItems();
      const sessions: [string, unknown][] = [
        ...NON_ADMIN_SESSIONS,
        ...(entry.frozen
          ? []
          : entry.refusedCallers.map((c): [string, unknown] => [
              c,
              sessionOf(c),
            ])),
      ];
      const full = !entry.frozen;
      const bodies: { body: unknown; contentType?: string }[] = [
        { body: "{not json" },
        { body: "{}" },
        ...(full
          ? [
              { body: entry.validBody, contentType: "text/plain" },
              { body: entry.validBody },
            ]
          : []),
      ];
      const idSets = full
        ? [entry.params.invalid, entry.params.valid]
        : [entry.params.invalid];
      for (const [, session] of sessions) {
        for (const call of bodies) {
          for (const params of idSets) {
            resetDeniedAudit();
            signInRaw(session);
            await expectError(
              await send(entry, { ...call, params }),
              403,
              "FORBIDDEN",
            );
          }
        }
      }
      expect(await nonAuditItems()).toEqual(before);
      noUpstreamCall(entry);
    },
  );

  it.each(adminWrites.map((e) => [label(e), e] as const))(
    "%s: a non-admin with a foreign Origin gets the permission 403 naming internal-admin, not the Origin 403",
    async (_name, entry) => {
      signIn("viewer");
      const res = await send(entry, { body: "{}", origin: FOREIGN });
      const parsed = await expectError(res, 403, "FORBIDDEN");
      expect(parsed.error.message).toBe("internal-admin role required");
    },
  );

  it.each(
    writes
      .filter((e) => e.kind === "matrix-write")
      .map((e) => [label(e), e] as const),
  )(
    "%s: a caller with no write permission gets 403 FORBIDDEN, never 400/404, for every body and id, before any table access",
    async (_name, entry) => {
      await prepare(entry);
      const before = await nonAuditItems();
      const sessions: [string, unknown][] = [
        ...NON_WRITER_SESSIONS,
        ...entry.refusedCallers.map((c): [string, unknown] => [
          c,
          sessionOf(c),
        ]),
      ];
      const bodies = [
        "{not json",
        "{}",
        JSON.stringify({ oid: "someone", version: 1 }),
      ];
      for (const [, session] of sessions) {
        for (const body of bodies) {
          for (const params of [entry.params.invalid, entry.params.valid]) {
            resetDeniedAudit();
            signInRaw(session);
            await expectError(
              await send(entry, { body, params }),
              403,
              "FORBIDDEN",
            );
          }
        }
      }
      expect(await nonAuditItems()).toEqual(before);
      noUpstreamCall(entry);
    },
  );

  it.each(
    writes
      .filter((e) => e.kind === "self-write")
      .map((e) => [label(e), e] as const),
  )(
    "%s: a session that is not a password user's (any role, including internal-admin) is 403 FORBIDDEN before parsing",
    async (_name, entry) => {
      const sessions: unknown[] = [
        ...NON_ADMIN_SESSIONS.map(([, s]) => s),
        ...entry.refusedCallers.map(sessionOf),
        sessionOf("admin"),
      ];
      for (const session of sessions) {
        for (const body of ["{not json", "{}"]) {
          resetDeniedAudit();
          signInRaw(session);
          await expectError(await send(entry, { body }), 403, "FORBIDDEN");
        }
      }
    },
  );
});

describe("3. a permitted caller with a missing or foreign Origin gets 403 before parsing (Enforcement item 6)", () => {
  it.each(writes.map((e) => [label(e), e] as const))(
    "%s",
    async (_name, entry) => {
      await prepare(entry);
      const before = await nonAuditItems();
      for (const caller of entry.permittedCallers) {
        for (const [, origin] of CROSS_SITE_ORIGINS) {
          for (const body of [entry.validBody, "{not json"]) {
            signIn(caller);
            await expectError(
              await send(entry, { body, origin }),
              403,
              "FORBIDDEN",
            );
          }
        }
      }
      expect(await nonAuditItems()).toEqual(before);
      noUpstreamCall(entry);
    },
  );

  // Not stopped by the session, role or origin gate. The self-service route
  // gets "{}": a valid body reaches its password check, which answers 403 for a
  // user the table does not hold.
  it.each(writes.map((e) => [label(e), e] as const))(
    "%s: a same-origin permitted caller is not stopped by the session, role or origin gate",
    async (_name, entry) => {
      await prepare(entry);
      for (const caller of entry.permittedCallers) {
        signIn(caller);
        const res = await send(entry, {
          body: entry.kind === "self-write" ? "{}" : entry.validBody,
        });
        expect([401, 403], `${entry.key} as ${caller}`).not.toContain(
          res.status,
        );
        expectNoStore(res);
      }
    },
  );
});

describe("4. bad input is 400 BAD_REQUEST, no-store, and writes nothing (Rule 10.3)", () => {
  it.each(writes.filter((e) => !e.frozen).map((e) => [label(e), e] as const))(
    "%s",
    async (_name, entry) => {
      await prepare(entry);
      const before = await nonAuditItems();
      const auditBefore = await auditToday();
      signIn(entry.permittedCallers[0] ?? "admin");
      await expectError(
        await send(entry, {
          body: entry.badInput?.body ?? "{not json",
          params: entry.badInput?.params ?? entry.params.valid,
        }),
        400,
        "BAD_REQUEST",
      );
      expect(await nonAuditItems()).toEqual(before);
      expect(await auditToday()).toEqual(auditBefore);
    },
  );

  it.each(
    reads
      .filter((e) => e.badQuery !== undefined)
      .map((e) => [label(e), e] as const),
  )("%s: a malformed query is 400 for an admin", async (_name, entry) => {
    signIn("admin");
    await expectError(
      await send(entry, { query: entry.badQuery }),
      400,
      "BAD_REQUEST",
    );
  });
});

describe("5. Cache-Control: private, no-store on every outcome (Enforcement item 4)", () => {
  it.each(
    reads.filter((e) => e.kind === "read").map((e) => [label(e), e] as const),
  )(
    "%s: a signed-in viewer and an admin both get the header",
    async (_name, entry) => {
      for (const caller of ["viewer", "admin"] as const) {
        signIn(caller);
        const res = await send(entry);
        await res.text();
        expectNoStore(res);
        if (entry.family === "core") expect(res.status).toBeLessThan(500);
      }
    },
  );

  it.each(
    reads
      .filter(
        (e) =>
          e.family === "core" &&
          !e.frozen &&
          Object.keys(e.params.valid).length > 0,
      )
      .map((e) => [label(e), e] as const),
  )(
    "%s: a detail read reaches 200 for an admin and the same refusal for an out-of-scope viewer (T15)",
    async (_name, entry) => {
      signIn("admin");
      await expectData(await send(entry));
      signIn("viewer");
      const res = await send(entry);
      expect([403, 404]).toContain(res.status);
      expectNoStore(res);
    },
  );

  it.each(
    writes
      .filter((e) => !e.frozen && e.successStatuses !== undefined)
      .map((e) => [label(e), e] as const),
  )(
    "%s: a successful write by a permitted caller carries the header",
    async (_name, entry) => {
      await prepare(entry);
      signIn(entry.permittedCallers[0] ?? "admin");
      const res = await send(entry, { body: entry.validBody });
      expect(entry.successStatuses).toContain(res.status);
      expectNoStore(res);
    },
  );
});

describe("6. one `denied` audit record per refused write, with no raw value (Audit log D17/T22)", () => {
  const leaves = (value: unknown, out: string[] = []): string[] => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => leaves(v, out));
    else if (value && typeof value === "object") {
      Object.values(value).forEach((v) => leaves(v, out));
    }
    return out;
  };

  const cases = writes
    .filter((e) => !e.frozen && e.denied !== undefined)
    .flatMap((e) =>
      e.refusedCallers.map((c) => [`${label(e)} as ${c}`, e, c] as const),
    );

  it.each(cases)("%s", async (_name, entry, caller) => {
    await prepare(entry);
    resetDeniedAudit();
    const probe = Object.fromEntries(
      Object.keys(entry.params.valid).map((name) => [
        name,
        `probe-${name}-path-value-91`,
      ]),
    );
    const before = (await auditToday()).length;
    const session = sessionOf(caller);
    signInRaw(session);
    await expectError(
      await send(entry, { body: entry.validBody, params: probe }),
      403,
      "FORBIDDEN",
    );
    const records = await auditToday();
    expect(records).toHaveLength(before + 1);
    const denied = await deniedToday();
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      actor: session.user.oid,
      action: entry.denied?.action,
      result: "denied",
      category: "security",
      code: "FORBIDDEN",
      route: { method: entry.method, pattern: entry.pattern },
    });
    const json = JSON.stringify(denied[0]);
    for (const raw of [
      ...Object.values(probe),
      ...leaves(entry.validBody).filter((s) => s.length >= 8),
      h.KEY,
    ]) {
      expect(json, `${entry.key} record leaks ${raw}`).not.toContain(raw);
    }
  });
});
