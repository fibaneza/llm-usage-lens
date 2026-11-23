import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ApiErrorBodySchema, ApiErrorCodeSchema } from "@llm-usage-lens/shared";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createFakeLiteLLM, healthyHandler } from "@/test/fakes/fake-litellm";
import type { FakeHandler } from "@/test/fakes/fake-litellm";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/support/test-support";
import { ctxAt, dumpTable, ok } from "@/test/support/access-test-support";
import { grantRole } from "@/lib/data/access/role-grants";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/
// connection GET Admin+Auditor, PUT Admin; /connection/test POST Admin, not
// audited; Cache-Control private, no-store; standard shapes), "Security
// architecture" items 5-8, 11 (test-before-save, versioned, audited; results
// ok/unauthorised/routes out of date/unreachable; 401 -> rotate and redeploy;
// open mode -> 403), decision LD4 (templated-route probe), threats LT1, LT6,
// LT11, LT12; Rules 10.3, 50.4, 60.23. Only `@/auth` and `fetch` (the fake
// LiteLLM) are replaced; storage and audit run on DynamoDB Local.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const KEY = "sk-fake-key-000";
const SENTINEL = "UPSTREAM-LEAK-SENTINEL-1";
const HOST = "localhost:3000";
const BASE_A = "http://litellm.test:4000";
const BASE_B = "http://litellm-b.test:4000";
const CONN_URL = `http://${HOST}/api/litellm/connection`;
const TEST_URL = `${CONN_URL}/test`;
const SAME_ORIGIN = { host: HOST, origin: `http://${HOST}` };

const session = (roles: string[]) => ({
  user: { oid: "oid-test", name: "T", email: "t@company.com", roles },
});
const ADMIN = session(["internal-admin"]);
const AUDITOR = session(["internal-auditor"]);
const VIEWER = session(["internal-viewer"]);

let fake: ReturnType<typeof createFakeLiteLLM>;
function installFake(handler: FakeHandler = healthyHandler) {
  fake = createFakeLiteLLM(handler);
  vi.stubGlobal("fetch", fake.fetch);
}

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  const vars = {
    APP_ENV: "dev",
    AUTH_ACCESS_MODE: "enforce",
    LITELLM_ALLOWED_HOSTS: "litellm.test:4000,litellm-b.test:4000",
    LITELLM_SERVICE_KEY: KEY,
    ...env,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  const conn = await import("../route");
  const test = await import("../test/route");
  return { GET: conn.GET, PUT: conn.PUT, POST: test.POST };
}

async function storeConnection(baseUrl = BASE_A, version = 1) {
  await testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: {
        PK: "LITELLM#CONFIG",
        SK: "CONNECTION",
        baseUrl,
        version,
        updatedAt: "2026-11-14T10:00:00.000Z",
      },
    }),
  );
}

const ctx = { params: Promise.resolve({}) };
const get = () => new Request(CONN_URL, { headers: { host: HOST } });
const send = (
  method: string,
  url: string,
  payload?: unknown,
  headers: Record<string, string> = SAME_ORIGIN,
) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

async function auditActions() {
  const { listAuditRecords } = await import("@/lib/data/access/audit");
  return (await listAuditRecords("2026-11-14")).filter((r) =>
    r.action.startsWith("litellm."),
  );
}

// Rule 60.24: retry backoff must never be waited out. Fake only the timers,
// then step them forward, yielding to real I/O (setImmediate) between steps.
async function settleWithFakeBackoff<T>(pending: Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));
  let done = false;
  const tracked = pending.finally(() => {
    done = true;
  });
  tracked.catch(() => {});
  for (let i = 0; i < 2_000 && !done; i += 1) {
    await vi.advanceTimersByTimeAsync(250);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  expect(done).toBe(true);
  return tracked;
}

async function storedUrl(): Promise<string | undefined> {
  const { getLiteLLMConnection } =
    await import("@/lib/data/litellm/connection");
  return (await getLiteLLMConnection())?.baseUrl;
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const text = await res.text();
  expect(text).not.toContain(KEY);
  expect(text).not.toContain(SENTINEL);
  const raw = JSON.parse(text);
  const parsed = ApiErrorBodySchema.parse(raw);
  expect(parsed.error.code).toBe(code);
  ApiErrorCodeSchema.parse(parsed.error.code);
  expect(raw.data).toBeUndefined();
  expect(res.headers.get("cache-control")).toBe("private, no-store");
}

async function expectNoLeak(res: Response) {
  const text = await res.clone().text();
  expect(text).not.toContain(KEY);
  expect(text).not.toContain(SENTINEL);
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));
  authMock.mockResolvedValue(ADMIN);
  installFake();
  await clearTable();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/litellm/connection", () => {
  it.each([
    ["a viewer", VIEWER],
    ["no roles", { user: { oid: "oid-test" } }],
  ])("returns 403 for %s", async (_n, s) => {
    authMock.mockResolvedValue(s);
    const { GET } = await load();
    await expectError(await GET(get(), ctx), 403, "FORBIDDEN");
  });

  it.each([
    ["an Admin", ADMIN],
    ["an Auditor", AUDITOR],
  ])(
    "returns the status for %s with no-store and without the key",
    async (_n, s) => {
      authMock.mockResolvedValue(s);
      await storeConnection();
      const { GET } = await load();
      const res = await GET(get(), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect((await res.clone().json()).data).toEqual({
        baseUrl: BASE_A,
        version: 1,
        edition: "oss",
        serviceKeyConfigured: true,
        defaultBaseUrl: "http://localhost:4000", // D-ST4
      });
      await expectNoLeak(res);
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("a stored internal-admin grant opens GET for a session whose claim lacks the role (Rule 50.4)", async () => {
    authMock.mockResolvedValue({ user: { oid: "oid-granted" } });
    ok(
      await grantRole(
        { oid: "oid-granted", role: "internal-admin", reason: "test" },
        ctxAt(),
      ),
    );
    const { GET } = await load();
    expect((await GET(get(), ctx)).status).toBe(200);
  });

  it("reports 'never configured' (baseUrl null, version 0) and serviceKeyConfigured false, without failing", async () => {
    const { GET } = await load({ LITELLM_SERVICE_KEY: "" });
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      baseUrl: null,
      version: 0,
      edition: "oss",
      serviceKeyConfigured: false,
      defaultBaseUrl: "http://localhost:4000", // D-ST4
    });
  });

  it("derives edition 'enterprise' from APP_ENV=prod", async () => {
    const { GET } = await load({ APP_ENV: "prod" });
    expect((await (await GET(get(), ctx)).json()).data.edition).toBe(
      "enterprise",
    );
  });
});

describe("PUT /api/litellm/connection", () => {
  const put = (payload: unknown, headers?: Record<string, string>) =>
    send("PUT", CONN_URL, payload, headers);

  it.each([
    ["an Auditor", AUDITOR],
    ["a viewer", VIEWER],
  ])(
    "returns 403 for %s, before parsing the body and with no LiteLLM call",
    async (_n, s) => {
      authMock.mockResolvedValue(s);
      const { PUT } = await load();
      await expectError(
        await PUT(put("not json at all"), ctx),
        403,
        "FORBIDDEN",
      );
      expect(fake.calls).toHaveLength(0);
      expect(await storedUrl()).toBeUndefined();
    },
  );

  // Source: Access Control spec D17 / T22 -- a refused write route appends one
  // `denied` record via withRoute `denied: { action, pattern }` (as
  // POST /api/accounts does); the fixed pattern, never the raw path.

  it.each([
    ["a missing baseUrl", { version: null }],
    ["a non-URL", { baseUrl: "nope", version: null }],
    [
      "a host outside LITELLM_ALLOWED_HOSTS",
      { baseUrl: "http://evil.test:4000", version: null },
    ],
    ["userinfo", { baseUrl: "http://u:p@litellm.test:4000", version: null }],
    ["a query", { baseUrl: `${BASE_A}?x=1`, version: null }],
    ["a fragment", { baseUrl: `${BASE_A}#f`, version: null }],
    [
      "an edition field (no input exists for it, LD11)",
      { baseUrl: BASE_A, version: null, edition: "enterprise" },
    ],
    [
      "a service key field",
      { baseUrl: BASE_A, version: null, serviceKey: "sk-x" },
    ],
    ["a non-integer version", { baseUrl: BASE_A, version: "1" }],
  ])(
    "returns 400 for %s: nothing called, nothing stored, nothing audited",
    async (_n, body) => {
      const { PUT } = await load();
      await expectError(await PUT(put(body), ctx), 400, "BAD_REQUEST");
      expect(fake.calls).toHaveLength(0);
      expect(await storedUrl()).toBeUndefined();
      expect(await auditActions()).toHaveLength(0);
    },
  );

  it("returns 400 for an http URL when APP_ENV=prod", async () => {
    const { PUT } = await load({
      APP_ENV: "prod",
      LITELLM_ALLOWED_HOSTS: "litellm.test:4000",
    });
    await expectError(
      await PUT(put({ baseUrl: BASE_A, version: null }), ctx),
      400,
      "BAD_REQUEST",
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("returns 400 for a non-JSON content type", async () => {
    const { PUT } = await load();
    const res = await PUT(
      new Request(CONN_URL, {
        method: "PUT",
        headers: { ...SAME_ORIGIN, "content-type": "text/plain" },
        body: "x",
      }),
      ctx,
    );
    await expectError(res, 400, "BAD_REQUEST");
  });

  it("tests the candidate URL first (Bearer key, to the new host), then saves version 1 and audits it", async () => {
    const { PUT } = await load();
    const res = await PUT(put({ baseUrl: BASE_B, version: null }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await res.clone().json()).data).toMatchObject({
      baseUrl: BASE_B,
      version: 1,
      edition: "oss",
      serviceKeyConfigured: true,
    });
    await expectNoLeak(res);
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const call of fake.calls) {
      expect(call.host).toBe("litellm-b.test:4000");
      expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    }
    expect(await storedUrl()).toBe(BASE_B);
    const records = await auditActions();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "litellm.connection.update",
      actor: "oid-test",
      result: "success",
      after: { baseUrl: BASE_B },
    });
    expect(JSON.stringify(records)).not.toContain(KEY);
  });

  it("updates an existing connection with the matching version", async () => {
    await storeConnection(BASE_A, 1);
    const { PUT } = await load();
    const res = await PUT(put({ baseUrl: BASE_B, version: 1 }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      baseUrl: BASE_B,
      version: 2,
    });
    expect((await auditActions())[0]).toMatchObject({
      before: { baseUrl: BASE_A },
      after: { baseUrl: BASE_B },
    });
  });

  it("returns 409 CONFLICT on a stale version and keeps the stored URL", async () => {
    await storeConnection(BASE_A, 2);
    const { PUT } = await load();
    await expectError(
      await PUT(put({ baseUrl: BASE_B, version: 1 }), ctx),
      409,
      "CONFLICT",
    );
    expect(await storedUrl()).toBe(BASE_A);
  });

  it.each<[string, FakeHandler]>([
    ["unauthorised (401)", () => ({ status: 401 })],
    [
      "routes out of date (403 on a templated route)",
      (call, attempt) =>
        /reset_spend|reset_budget|regenerate/.test(call.path)
          ? { status: 403 }
          : healthyHandler(call, attempt),
    ],
    ["unreachable (5xx)", () => ({ status: 503 })],
  ])(
    "does not save when the connection test fails: %s",
    async (_name, handler) => {
      installFake(handler);
      await storeConnection(BASE_A, 1);
      const { PUT } = await load();
      const res = await settleWithFakeBackoff(
        PUT(put({ baseUrl: BASE_B, version: 1 }), ctx),
      );
      await expectError(res, 503, "LITELLM_UNAVAILABLE");
      expect(await storedUrl()).toBe(BASE_A);
      expect(await auditActions()).toHaveLength(0);
    },
  );

  it("does not save and calls nothing when the service key is not configured", async () => {
    const { PUT } = await load({ LITELLM_SERVICE_KEY: "" });
    await expectError(
      await PUT(put({ baseUrl: BASE_A, version: null }), ctx),
      503,
      "LITELLM_UNAVAILABLE",
    );
    expect(fake.calls).toHaveLength(0);
    expect(await storedUrl()).toBeUndefined();
  });

  it("never stores the service key or an upstream body (LT1, LT12)", async () => {
    installFake((call) =>
      /reset_|regenerate/.test(call.path)
        ? { status: 404, body: { detail: SENTINEL, key: KEY } }
        : { status: 200, body: { echo: KEY, detail: SENTINEL } },
    );
    const { PUT } = await load();
    const res = await PUT(put({ baseUrl: BASE_A, version: null }), ctx);
    await expectNoLeak(res);
    const dump = await dumpTable();
    expect(dump).not.toContain(KEY);
    expect(dump).not.toContain(SENTINEL);
  });
});

describe("POST /api/litellm/connection/test", () => {
  const post = (payload?: unknown, headers?: Record<string, string>) =>
    send("POST", TEST_URL, payload ?? {}, headers);

  it.each([
    ["an Auditor", AUDITOR],
    ["a viewer", VIEWER],
  ])("returns 403 for %s with no LiteLLM call", async (_n, s) => {
    authMock.mockResolvedValue(s);
    await storeConnection();
    const { POST } = await load();
    await expectError(await POST(post(), ctx), 403, "FORBIDDEN");
    expect(fake.calls).toHaveLength(0);
  });

  it("reports ok on OSS (dev), probing a read and the two reset routes (LD4) with the key, and is not audited", async () => {
    await storeConnection();
    const { POST } = await load();
    const res = await POST(post(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await res.clone().json()).data.result).toBe("ok");
    await expectNoLeak(res);
    const paths = fake.calls.map((c) => c.path);
    expect(paths.some((p) => p === "/team/list")).toBe(true);
    expect(
      paths.some((p) => /^\/team\/[^/]+\/member\/[^/]+\/reset_spend$/.test(p)),
    ).toBe(true);
    expect(
      paths.some((p) => /^\/team\/[^/]+\/member\/[^/]+\/reset_budget$/.test(p)),
    ).toBe(true);
    expect(paths.some((p) => /regenerate/.test(p))).toBe(false);
    for (const call of fake.calls) {
      expect(call.host).toBe("litellm.test:4000");
      expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    }
    expect(await auditActions()).toHaveLength(0);
    expect(await storedUrl()).toBe(BASE_A);
  });

  // LT15 / Edition: Enterprise-only operations make no LiteLLM call on OSS.
  it("makes no regenerate call when APP_ENV=dev (OSS), only /team/list and the two reset routes", async () => {
    await storeConnection();
    const { POST } = await load({ APP_ENV: "dev" });
    const res = await POST(post(), ctx);
    expect((await res.json()).data.result).toBe("ok");
    const paths = fake.calls.map((c) => c.path);
    expect(paths.some((p) => /regenerate/.test(p))).toBe(false);
    expect(paths).toContain("/team/list");
    expect(
      paths.filter((p) => /reset_spend$|reset_budget$/.test(p)),
    ).toHaveLength(2);
  });

  it("stays ok on OSS when LiteLLM would answer regenerate with a 500 Enterprise error", async () => {
    installFake((call, n) =>
      /regenerate/.test(call.path)
        ? {
            status: 500,
            body: {
              detail: "Regenerating Virtual Keys is an Enterprise feature",
            },
          }
        : healthyHandler(call, n),
    );
    await storeConnection();
    const { POST } = await load({ APP_ENV: "dev" });
    const res = await POST(post(), ctx);
    expect((await res.json()).data.result).toBe("ok");
    expect(fake.calls.some((c) => /regenerate/.test(c.path))).toBe(false);
  });

  it("still probes regenerate when APP_ENV=prod (enterprise)", async () => {
    await storeConnection("https://litellm.test:4000");
    const { POST } = await load({ APP_ENV: "prod" });
    const res = await POST(post(), ctx);
    expect((await res.json()).data.result).toBe("ok");
    expect(
      fake.calls.some((c) => /^\/key\/[^/]+\/regenerate$/.test(c.path)),
    ).toBe(true);
  });

  it("reports routes_out_of_date in prod when only the regenerate probe answers 403", async () => {
    installFake((call, n) =>
      /regenerate/.test(call.path)
        ? { status: 403, body: { detail: SENTINEL } }
        : healthyHandler(call, n),
    );
    await storeConnection("https://litellm.test:4000");
    const { POST } = await load({ APP_ENV: "prod" });
    const res = await POST(post(), ctx);
    expect((await res.clone().json()).data.result).toBe("routes_out_of_date");
    await expectNoLeak(res);
  });

  it("reports unauthorised with a 'rotate and redeploy' message and does not retry the 401", async () => {
    installFake(() => ({ status: 401, body: { detail: SENTINEL } }));
    await storeConnection();
    const { POST } = await load();
    const res = await POST(post(), ctx);
    expect(res.status).toBe(200);
    const body = (await res.clone().json()).data;
    expect(body.result).toBe("unauthorised");
    expect(body.message).toMatch(/rotate and redeploy/i);
    await expectNoLeak(res);
    expect(fake.calls).toHaveLength(1);
  });

  it("reports 'routes out of date' when a templated route answers 403", async () => {
    installFake((call) =>
      /reset_spend|reset_budget|regenerate/.test(call.path)
        ? { status: 403, body: { detail: SENTINEL } }
        : healthyHandler(call, 1),
    );
    await storeConnection();
    const { POST } = await load();
    const res = await POST(post(), ctx);
    expect((await res.clone().json()).data.result).toBe("routes_out_of_date");
    await expectNoLeak(res);
  });

  it("reports unreachable on a network failure or 5xx, with no upstream text (LT12)", async () => {
    installFake(() => ({ status: 500, body: { detail: SENTINEL } }));
    await storeConnection();
    const { POST } = await load();
    const res = await settleWithFakeBackoff(POST(post(), ctx));
    expect(res.status).toBe(200);
    expect((await res.clone().json()).data.result).toBe("unreachable");
    await expectNoLeak(res);
  });

  it("reports not_configured with no call when the service key is missing", async () => {
    await storeConnection();
    const { POST } = await load({ LITELLM_SERVICE_KEY: "" });
    const res = await POST(post(), ctx);
    expect((await res.json()).data.result).toBe("not_configured");
    expect(fake.calls).toHaveLength(0);
  });

  it("reports not_configured with no call when no connection is stored and no baseUrl is given", async () => {
    const { POST } = await load();
    const res = await POST(post(), ctx);
    expect((await res.json()).data.result).toBe("not_configured");
    expect(fake.calls).toHaveLength(0);
  });

  it("tests a candidate baseUrl from the body without saving or auditing it", async () => {
    await storeConnection(BASE_A, 1);
    const { POST } = await load();
    const res = await POST(post({ baseUrl: BASE_B }), ctx);
    expect((await res.json()).data.result).toBe("ok");
    expect(fake.calls.every((c) => c.host === "litellm-b.test:4000")).toBe(
      true,
    );
    expect(await storedUrl()).toBe(BASE_A);
    expect(await auditActions()).toHaveLength(0);
  });

  it.each([
    ["a host outside the allowlist", { baseUrl: "http://evil.test:4000" }],
    ["userinfo", { baseUrl: "http://u:p@litellm.test:4000" }],
    ["a query", { baseUrl: `${BASE_A}?x=1` }],
    ["a fragment", { baseUrl: `${BASE_A}#f` }],
    ["an unknown field", { baseUrl: BASE_A, edition: "enterprise" }],
  ])("returns 400 for %s and calls nothing (LT6)", async (_n, body) => {
    const { POST } = await load();
    await expectError(await POST(post(body), ctx), 400, "BAD_REQUEST");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("AUTH_ACCESS_MODE=open (LT11)", () => {
  it("answers 403 OPERATION_UNAVAILABLE on every LiteLLM route, even for an Admin, with no call, read or write", async () => {
    await storeConnection();
    const { GET, PUT, POST } = await load({ AUTH_ACCESS_MODE: "open" });
    await expectError(await GET(get(), ctx), 403, "OPERATION_UNAVAILABLE");
    await expectError(
      await PUT(send("PUT", CONN_URL, { baseUrl: BASE_B, version: 1 }), ctx),
      403,
      "OPERATION_UNAVAILABLE",
    );
    await expectError(
      await POST(send("POST", TEST_URL, {}), ctx),
      403,
      "OPERATION_UNAVAILABLE",
    );
    expect(fake.calls).toHaveLength(0);
    expect(await storedUrl()).toBe(BASE_A);
  });

  it("still answers 401 to an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null);
    const { GET } = await load({ AUTH_ACCESS_MODE: "open" });
    await expectError(await GET(get(), ctx), 401, "UNAUTHORIZED");
  });
});

// LD24 / LT22 (spec 2026-11-10-litellm.md): the connection is readable by an
// internal-org-admin but stays Admin-only to write. The 403 and its `denied`
// record for the PUT and the test are asserted once, by the route-contract
// suite (test/route-registry.ts), not repeated here (Rule 60.23).
describe("internal-org-admin on /api/litellm/connection (LD24)", () => {
  it("GET answers 200 for an org-admin", async () => {
    authMock.mockResolvedValue({
      user: { oid: "oid-org", name: "O", roles: ["internal-org-admin"] },
    });
    const { GET } = await load();
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    await expectNoLeak(res);
  });
});

// Source: docs/specs/2026-11-10-litellm.md (connection), D-ST4; docs/guides/litellm-admin.md
// (LLM_LENS_LITELLM_BASE_URL: offered, never saved by itself; the allowed-hosts
// rule still applies, so localhost is refused where it is not allowed).
describe("LLM_LENS_LITELLM_BASE_URL default (D-ST4)", () => {
  it("GET offers the default as defaultBaseUrl and writes nothing", async () => {
    const { GET } = await load({
      LLM_LENS_LITELLM_BASE_URL: "http://localhost:4000",
    });
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.baseUrl).toBeNull();
    expect(data.defaultBaseUrl).toBe("http://localhost:4000");
    expect(await storedUrl()).toBeUndefined();
  });

  it("GET offers http://localhost:4000 when the variable is unset", async () => {
    const { GET } = await load();
    const data = (await (await GET(get(), ctx)).json()).data;
    expect(data.defaultBaseUrl).toBe("http://localhost:4000");
  });

  it("PUT of the default host is still refused when it is not in the allowlist", async () => {
    const { PUT } = await load({ APP_ENV: "prod" });
    const res = await PUT(
      send("PUT", CONN_URL, {
        baseUrl: "http://localhost:4000",
        version: null,
      }),
      ctx,
    );
    await expectError(res, 400, "BAD_REQUEST");
    expect(await storedUrl()).toBeUndefined();
  });
});
