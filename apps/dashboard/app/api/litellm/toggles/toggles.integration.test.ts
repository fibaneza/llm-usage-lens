import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  ApiErrorBodySchema,
  LITELLM_OPERATION_NAMES,
} from "@llm-usage-lens/shared";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createFakeLiteLLM } from "@/test/fake-litellm";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/test-support";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/
// toggles GET Admin+Auditor, PUT Admin; Cache-Control private, no-store;
// standard { data } / { error } shapes), "Toggles narrow only" (DynamoDB,
// versioned, audited), "Guardrail configuration" (effective value and source
// ui|file|spec per operation; reset to file defaults is Admin, audited,
// versioned like any toggle write; reads have toggles), decision LD10, "Data
// model additions" (OperationToggles at LITELLM#CONFIG / TOGGLES), Access
// Control D17 (denied audit record per refused write), Rules 10.3, 60.23.
//
// Contract for the developer:
//   GET  -> data = { version: number (0 when never saved), edition,
//                    (no wildcardWarning: code-only, LD19 amended),
//                    operations: { [op]: { enabled: boolean, source: "ui"|"file"|"spec" } } }
//   PUT  body { version: number|null, toggles: { [op]: boolean } }   (merge into the saved map)
//        or   { version: number, reset: true }                        (clears saved values)
//        -> 200 with the same data as GET; 409 CONFLICT on a stale version.
//   Stored item: PK LITELLM#CONFIG, SK TOGGLES, { version, toggles, updatedAt }.
//   Audit actions: litellm.toggles.update and litellm.toggles.reset.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const HOST = "localhost:3000";
const URL_ = `http://${HOST}/api/litellm/toggles`;
const SAME_ORIGIN = { host: HOST, origin: `http://${HOST}` };
const session = (roles: string[]) => ({
  user: { oid: "oid-test", name: "T", email: "t@company.com", roles },
});
const ADMIN = session(["internal-admin"]);
const AUDITOR = session(["internal-auditor"]);
const VIEWER = session(["internal-viewer"]);
const ORG_ADMIN = {
  user: {
    oid: "oid-org",
    name: "O",
    email: "o@company.com",
    roles: ["internal-org-admin"],
  },
};

let fake: ReturnType<typeof createFakeLiteLLM>;

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  const vars = {
    APP_ENV: "dev",
    AUTH_ACCESS_MODE: "enforce",
    LITELLM_ALLOWED_HOSTS: "litellm.test:4000",
    LITELLM_SERVICE_KEY: "sk-fake-key-000",
    ...env,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  const mod = await import("./route");
  return { GET: mod.GET, PUT: mod.PUT };
}

const ctx = { params: Promise.resolve({}) };
const get = () => new Request(URL_, { headers: { host: HOST } });
const put = (payload: unknown, headers: Record<string, string> = SAME_ORIGIN) =>
  new Request(URL_, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

async function stored() {
  const res = await testDoc().send(
    new GetCommand({
      TableName: TEST_TABLE_NAME,
      Key: { PK: "LITELLM#CONFIG", SK: "TOGGLES" },
    }),
  );
  return res.Item as
    | { version: number; toggles: Record<string, boolean> }
    | undefined;
}

async function auditActions() {
  const { listAuditRecords } = await import("@/lib/data/access/audit");
  return (await listAuditRecords("2026-11-14")).filter((r) =>
    r.action.startsWith("litellm."),
  );
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const raw = await res.clone().json();
  expect(ApiErrorBodySchema.parse(raw).error.code).toBe(code);
  expect(raw.data).toBeUndefined();
  expect(res.headers.get("cache-control")).toBe("private, no-store");
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));
  authMock.mockResolvedValue(ADMIN);
  fake = createFakeLiteLLM();
  vi.stubGlobal("fetch", fake.fetch);
  await clearTable();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Effective = Record<string, { enabled: boolean; source: string }>;
const ops = async (res: Response) =>
  (await res.clone().json()).data.operations as Effective;

describe("GET /api/litellm/toggles", () => {
  it.each([
    ["a viewer", VIEWER],
    ["no roles", { user: { oid: "oid-test" } }],
  ])("returns 403 for %s", async (_n, s) => {
    authMock.mockResolvedValue(s);
    const { GET } = await load();
    await expectError(await GET(get(), ctx), 403, "FORBIDDEN");
  });

  it("returns 403 OPERATION_UNAVAILABLE in open access mode", async () => {
    const { GET } = await load({ AUTH_ACCESS_MODE: "open" });
    await expectError(await GET(get(), ctx), 403, "OPERATION_UNAVAILABLE");
  });

  it.each([
    ["an Admin", ADMIN],
    ["an Auditor", AUDITOR],
  ])(
    "returns every operation's effective value and source for %s, no-store, with no LiteLLM call",
    async (_n, s) => {
      authMock.mockResolvedValue(s);
      const { GET } = await load();
      const res = await GET(get(), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const data = (await res.clone().json()).data;
      expect(data.version).toBe(0);
      expect(data.edition).toBe("oss");
      expect(data).not.toHaveProperty("wildcardWarning");
      expect(Object.keys(data.operations).sort()).toEqual(
        [...LITELLM_OPERATION_NAMES].sort(),
      );
      for (const v of Object.values(data.operations as Effective)) {
        expect(typeof v.enabled).toBe("boolean");
        expect(["file", "spec"]).toContain(v.source);
      }
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("the shipped config file keeps the LD10 defaults (destructive off, removeTeamMember on, reads on)", async () => {
    const { GET } = await load();
    const o = await ops(await GET(get(), ctx));
    expect(o.resetMemberSpend?.enabled).toBe(false);
    expect(o.deleteKey?.enabled).toBe(false);
    expect(o.removeTeamMember?.enabled).toBe(true);
    expect(o.getTeam?.enabled).toBe(true);
    expect(o.createTeam?.enabled).toBe(true);
  });

  it("reports edition 'enterprise' for APP_ENV=prod", async () => {
    const { GET } = await load({ APP_ENV: "prod" });
    expect((await (await GET(get(), ctx)).json()).data.edition).toBe(
      "enterprise",
    );
  });

  it("shows source 'ui' only for operations that have a saved value", async () => {
    await testDoc().send(
      new PutCommand({
        TableName: TEST_TABLE_NAME,
        Item: {
          PK: "LITELLM#CONFIG",
          SK: "TOGGLES",
          version: 3,
          toggles: { createTeam: false },
          updatedAt: "2026-11-14T09:00:00.000Z",
        },
      }),
    );
    const { GET } = await load();
    const res = await GET(get(), ctx);
    expect((await res.clone().json()).data.version).toBe(3);
    const o = await ops(res);
    expect(o.createTeam).toEqual({ enabled: false, source: "ui" });
    expect(o.getTeam?.source).not.toBe("ui");
  });
});

describe("PUT /api/litellm/toggles", () => {
  it.each([
    ["an Auditor", AUDITOR],
    ["a viewer", VIEWER],
  ])(
    "returns 403 for %s before parsing the body, stores nothing, and writes one denied audit record",
    async (_n, s) => {
      authMock.mockResolvedValue(s);
      const { PUT } = await load();
      await expectError(await PUT(put("not json"), ctx), 403, "FORBIDDEN");
      expect(await stored()).toBeUndefined();
      const records = await auditActions();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "litellm.toggles.update",
        actor: "oid-test",
        result: "denied",
        code: "FORBIDDEN",
        route: { method: "PUT", pattern: "/api/litellm/toggles" },
      });
    },
  );

  // LD24 / Rule 60.23: the `permit` gate's fixed refusal text, moved here from
  // the shared matrix-write sweep (which stays generic).
  it("an org-less caller (an Auditor) is refused with the permit gate's fixed message (LD24)", async () => {
    authMock.mockResolvedValue(AUDITOR);
    const { PUT } = await load();
    const res = await PUT(put({ version: null, toggles: {} }), ctx);
    await expectError(res, 403, "FORBIDDEN");
    expect((await res.clone().json()).error.message).toBe(
      "Insufficient permission",
    );
  });

  it("a refused reset (no Admin role) records litellm.toggles.reset, not litellm.toggles.update", async () => {
    authMock.mockResolvedValue(AUDITOR);
    const { PUT } = await load();
    await expectError(
      await PUT(put({ version: 1, reset: true }), ctx),
      403,
      "FORBIDDEN",
    );
    const records = await auditActions();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "litellm.toggles.reset",
      actor: "oid-test",
      result: "denied",
      code: "FORBIDDEN",
    });
    expect(await stored()).toBeUndefined();
  });

  // Rule 10.3 (a refusal comes before input parsing) + L2 carry-over: the
  // body peek that picks the denied action reads a bounded prefix only.
  it("a refused write with an oversized streaming body still yields one 403 and one denied record, reading a bounded prefix", async () => {
    authMock.mockResolvedValue(AUDITOR);
    const CHUNK = 16 * 1024;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 400 * CHUNK) return controller.close();
        pulled += CHUNK;
        controller.enqueue(new Uint8Array(CHUNK).fill(120));
      },
    });
    const request = new Request(URL_, {
      method: "PUT",
      headers: { "content-type": "application/json", ...SAME_ORIGIN },
      body,
      duplex: "half",
    } as RequestInit);
    const { PUT } = await load();
    await expectError(await PUT(request, ctx), 403, "FORBIDDEN");
    expect(pulled).toBeLessThanOrEqual(256 * 1024);
    const records = await auditActions();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "litellm.toggles.update",
      result: "denied",
    });
  });

  it("returns 403 OPERATION_UNAVAILABLE in open access mode", async () => {
    const { PUT } = await load({ AUTH_ACCESS_MODE: "open" });
    await expectError(
      await PUT(put({ version: null, toggles: { createTeam: false } }), ctx),
      403,
      "OPERATION_UNAVAILABLE",
    );
    expect(await stored()).toBeUndefined();
  });

  it.each([
    ["an unknown operation", { version: null, toggles: { deleteTeam: true } }],
    [
      "a route as an operation",
      { version: null, toggles: { "/team/delete": true } },
    ],
    ["a non-boolean value", { version: null, toggles: { createTeam: "yes" } }],
    ["a wildcard value", { version: null, toggles: { createTeam: "*" } }],
    [
      "an extra field",
      { version: null, toggles: { createTeam: false }, routes: ["/x"] },
    ],
    [
      "an edition field (LD11)",
      { version: null, toggles: { createTeam: false }, edition: "enterprise" },
    ],
    ["a missing version", { toggles: { createTeam: false } }],
    [
      "toggles together with reset",
      { version: 1, toggles: { createTeam: false }, reset: true },
    ],
    ["reset without a version", { reset: true }],
    ["a non-object body", []],
  ])(
    "returns 400 for %s: nothing stored, nothing audited, no LiteLLM call",
    async (_n, body) => {
      const { PUT } = await load();
      await expectError(await PUT(put(body), ctx), 400, "BAD_REQUEST");
      expect(await stored()).toBeUndefined();
      expect(await auditActions()).toHaveLength(0);
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("creates the item at version 1 when version is null, returns the effective values, and writes one audit record", async () => {
    const { PUT } = await load();
    const res = await PUT(
      put({ version: null, toggles: { createTeam: false, deleteKey: true } }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const data = (await res.clone().json()).data;
    expect(data.version).toBe(1);
    expect(data.operations.createTeam).toEqual({
      enabled: false,
      source: "ui",
    });
    expect(data.operations.deleteKey).toEqual({ enabled: true, source: "ui" });

    const item = await stored();
    expect(item?.version).toBe(1);
    expect(item?.toggles).toEqual({ createTeam: false, deleteKey: true });

    const records = await auditActions();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "litellm.toggles.update",
      actor: "oid-test",
      result: "success",
    });
    expect(JSON.stringify(records[0])).toContain("createTeam");
    expect(fake.calls).toHaveLength(0);
  });

  it("the first save on a fresh deployment works from the version GET reports (0): GET -> PUT creates version 1", async () => {
    const { GET, PUT } = await load();
    const fresh = (await (await GET(get(), ctx)).json()).data;
    expect(fresh.version).toBe(0);
    // The client must send a version the route accepts for "nothing saved":
    // null (create). A literal 0 is not a saved version.
    const res = await PUT(
      put({ version: null, toggles: { createTeam: false } }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.version).toBe(1);
    expect((await stored())?.version).toBe(1);
  });

  it("merges later writes into the saved map and bumps the version", async () => {
    const { PUT } = await load();
    await PUT(put({ version: null, toggles: { createTeam: false } }), ctx);
    const res = await PUT(
      put({ version: 1, toggles: { getTeam: false } }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect((await res.clone().json()).data.version).toBe(2);
    expect((await stored())?.toggles).toEqual({
      createTeam: false,
      getTeam: false,
    });
    expect(await auditActions()).toHaveLength(2);
  });

  it("returns 409 CONFLICT for a stale version and writes nothing", async () => {
    const { PUT } = await load();
    await PUT(put({ version: null, toggles: { createTeam: false } }), ctx);
    await expectError(
      await PUT(put({ version: null, toggles: { getTeam: false } }), ctx),
      409,
      "CONFLICT",
    );
    await expectError(
      await PUT(put({ version: 7, toggles: { getTeam: false } }), ctx),
      409,
      "CONFLICT",
    );
    expect((await stored())?.toggles).toEqual({ createTeam: false });
    expect(await auditActions()).toHaveLength(1);
  });

  it("reset clears the saved values (back to file/spec sources), bumps the version and writes a litellm.toggles.reset audit record", async () => {
    const { PUT } = await load();
    await PUT(put({ version: null, toggles: { createTeam: false } }), ctx);
    const res = await PUT(put({ version: 1, reset: true }), ctx);
    expect(res.status).toBe(200);
    const data = (await res.clone().json()).data;
    expect(data.version).toBe(2);
    for (const v of Object.values(data.operations as Effective)) {
      expect(v.source).not.toBe("ui");
    }
    expect((await stored())?.toggles ?? {}).toEqual({});
    const actions = (await auditActions()).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "litellm.toggles.update",
        "litellm.toggles.reset",
      ]),
    );
    expect(actions).toHaveLength(2);
  });

  it("reset with a stale version is 409 and leaves the saved values", async () => {
    const { PUT } = await load();
    await PUT(put({ version: null, toggles: { createTeam: false } }), ctx);
    await expectError(
      await PUT(put({ version: 5, reset: true }), ctx),
      409,
      "CONFLICT",
    );
    expect((await stored())?.toggles).toEqual({ createTeam: false });
  });

  it("a saved toggle takes effect on the gateway immediately (disabled write -> 403, no call)", async () => {
    const { PUT } = await load();
    await PUT(put({ version: null, toggles: { createTeam: false } }), ctx);
    vi.stubGlobal("fetch", fake.fetch);
    await testDoc().send(
      new PutCommand({
        TableName: TEST_TABLE_NAME,
        Item: {
          PK: "LITELLM#CONFIG",
          SK: "CONNECTION",
          baseUrl: "http://litellm.test:4000",
          version: 1,
          updatedAt: "2026-11-14T10:00:00.000Z",
        },
      }),
    );
    const operations =
      (await import("@/lib/litellm/operations")) as unknown as Record<
        string,
        (i: unknown, c: unknown) => Promise<unknown>
      >;
    await expect(
      operations.createTeam!(
        { teamAlias: "A", dashboardTeamId: "team-a" },
        { actor: { oid: "oid-test", email: "t@company.com" } },
      ),
    ).rejects.toMatchObject({ code: "OPERATION_DISABLED", status: 403 });
    expect(fake.calls).toHaveLength(0);
  });
});

// LD24 / LT22 (spec 2026-11-10-litellm.md): internal-org-admin reads and writes
// the operation toggles, reset included; every write is audited with the
// actor. A role held only through a stored RoleGrant counts (Rule 50.4).
describe("internal-org-admin on /api/litellm/toggles (LD24, LT22)", () => {
  it("GET answers 200 for an org-admin (reads add org-admin, API routes table)", async () => {
    authMock.mockResolvedValue(ORG_ADMIN);
    const { GET } = await load();
    expect((await GET(get(), ctx)).status).toBe(200);
  });

  it("PUT saves toggles and writes one success audit record with the org-admin as actor", async () => {
    authMock.mockResolvedValue(ORG_ADMIN);
    const { PUT } = await load();
    const res = await PUT(
      put({ version: null, toggles: { createTeam: false } }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect((await stored())?.toggles).toEqual({ createTeam: false });
    const records = await auditActions();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "litellm.toggles.update",
      actor: "oid-org",
      result: "success",
    });
  });

  it("reset succeeds for an org-admin and is audited as litellm.toggles.reset by that actor", async () => {
    const { PUT } = await load();
    await PUT(put({ version: null, toggles: { createTeam: false } }), ctx);
    authMock.mockResolvedValue(ORG_ADMIN);
    const res = await PUT(put({ version: 1, reset: true }), ctx);
    expect(res.status).toBe(200);
    expect((await stored())?.toggles ?? {}).toEqual({});
    const reset = (await auditActions()).filter(
      (r) => r.action === "litellm.toggles.reset",
    );
    expect(reset).toHaveLength(1);
    expect(reset[0]).toMatchObject({ actor: "oid-org", result: "success" });
  });

  it("an internal-org-admin held only as a stored RoleGrant (no claim) reads and writes (Rule 50.4)", async () => {
    const { grantRole } = await import("@/lib/data/access/role-grants");
    const { ctxAt, ok } = await import("@/lib/data/access/access-test-support");
    authMock.mockResolvedValue({ user: { oid: "oid-granted" } });
    ok(
      await grantRole(
        { oid: "oid-granted", role: "internal-org-admin", reason: "test" },
        ctxAt(),
      ),
    );
    const { GET, PUT } = await load();
    expect((await GET(get(), ctx)).status).toBe(200);
    const res = await PUT(
      put({ version: null, toggles: { createTeam: false } }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect((await auditActions())[0]).toMatchObject({
      actor: "oid-granted",
      result: "success",
    });
  });
});
