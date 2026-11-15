import { PutCommand } from "@aws-sdk/lib-dynamodb";
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
  TEAM_ID,
  TOKEN_A,
  USER_ID,
  gatewayHandler,
} from "@/test/fake-litellm-gateway";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/test-support";

// Source: docs/specs/2026-11-10-litellm.md — "Toggles narrow only" (a
// disabled operation returns 403 OPERATION_DISABLED before any LiteLLM call,
// writes and, since LD19, reads), "Edition" (Enterprise-only operations return
// 403 OPERATION_UNAVAILABLE on OSS with no call; edition from APP_ENV),
// "Guardrail configuration" precedence (saved OperationToggles > config file >
// LD10), decision LD10 (resetMemberSpend and deleteKey default off), threat
// LT15; implementation-phases L2 Verify.
//
// Contract: operations throw an error with `{ code, status: 403 }` where code
// is "OPERATION_DISABLED" or "OPERATION_UNAVAILABLE" (class
// LiteLLMOperationRefused, exported from lib/litellm/gateway.ts), thrown before
// any request. The file defaults come from `loadGatewayConfig()` in
// lib/litellm/gateway-config.ts (mocked here to control the file layer).
const KEY = "sk-fake-key-000";
const BASE = "http://litellm.test:4000";
const CTX = { actor: { oid: "oid-actor-1", email: "admin@company.com" } };

type Ops = Record<string, (input?: unknown, ctx?: unknown) => Promise<unknown>>;

async function load(
  env: Record<string, string> = {},
  fileOperations?: Record<string, { enabled: boolean }>,
): Promise<Ops> {
  vi.resetModules();
  // Security architecture item 7: APP_ENV=prod requires an https base URL.
  if (env.APP_ENV === "prod") {
    await storeConnection("https://litellm.test");
    env = { LITELLM_ALLOWED_HOSTS: "litellm.test", ...env };
  }
  vi.doUnmock("@/lib/litellm/gateway-config");
  if (fileOperations) {
    vi.doMock("@/lib/litellm/gateway-config", () => ({
      loadGatewayConfig: () => ({
        operations: fileOperations,
        wildcardWarning: true,
      }),
    }));
  }
  const vars = {
    APP_ENV: "dev",
    AUTH_ACCESS_MODE: "enforce",
    LITELLM_ALLOWED_HOSTS: "litellm.test:4000",
    LITELLM_SERVICE_KEY: KEY,
    ...env,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  return (await import("./operations")) as unknown as Ops;
}

async function put(sk: string, item: Record<string, unknown>) {
  await testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: { PK: "LITELLM#CONFIG", SK: sk, ...item },
    }),
  );
}
const storeConnection = (baseUrl: string = BASE) =>
  put("CONNECTION", {
    baseUrl,
    version: 1,
    updatedAt: "2026-11-14T10:00:00.000Z",
  });
const storeToggles = (toggles: Record<string, boolean>) =>
  put("TOGGLES", {
    version: 1,
    toggles,
    updatedAt: "2026-11-14T10:00:00.000Z",
  });

let fake: ReturnType<typeof createFakeLiteLLM>;
function install(opts: Parameters<typeof gatewayHandler>[0] = {}) {
  fake = createFakeLiteLLM(gatewayHandler(opts));
  vi.stubGlobal("fetch", fake.fetch);
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  await storeConnection();
  install();
});
afterEach(() => {
  vi.doUnmock("@/lib/litellm/gateway-config");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DISABLED = { code: "OPERATION_DISABLED", status: 403 };
const UNAVAILABLE = { code: "OPERATION_UNAVAILABLE", status: 403 };

describe("edition gate (LT15)", () => {
  const input = { startDate: "2026-11-01", endDate: "2026-11-14" };

  it("getGlobalSpendReport on OSS (APP_ENV=dev): 403 OPERATION_UNAVAILABLE, no call", async () => {
    const ops = await load({ APP_ENV: "dev" });
    await expect(ops.getGlobalSpendReport!(input)).rejects.toMatchObject(
      UNAVAILABLE,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("getGlobalSpendReport on Enterprise (APP_ENV=prod) is called", async () => {
    install({ edition: "enterprise" });
    const ops = await load({ APP_ENV: "prod" });
    await ops.getGlobalSpendReport!(input);
    expect(fake.calls).toHaveLength(1);
  });

  it("the edition gate also applies when the operation is toggled on (a flag can only enable operations already allowed)", async () => {
    await storeToggles({ getGlobalSpendReport: true });
    const ops = await load({ APP_ENV: "dev" });
    await expect(ops.getGlobalSpendReport!(input)).rejects.toMatchObject(
      UNAVAILABLE,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("Enterprise-only and disabled: the toggle is reported first or second, but never a call", async () => {
    await storeToggles({ getGlobalSpendReport: false });
    const ops = await load({ APP_ENV: "dev" });
    await expect(ops.getGlobalSpendReport!(input)).rejects.toMatchObject({
      status: 403,
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("rotateKey on OSS composes (it is not refused); on Enterprise it regenerates", async () => {
    const rotate = {
      tokenId: TOKEN_A,
      litellmTeamId: TEAM_ID,
      litellmUserId: USER_ID,
      dashboardTeamId: "team-a",
    };
    const oss = await load({ APP_ENV: "dev" });
    await oss.rotateKey!(rotate, CTX);
    expect(fake.calls.some((c) => c.path.endsWith("/regenerate"))).toBe(false);

    install({ edition: "enterprise" });
    const ent = await load({ APP_ENV: "prod" });
    await ent.rotateKey!(rotate, CTX);
    expect(fake.calls.map((c) => c.path)).toEqual([
      `/key/${TOKEN_A}/regenerate`,
    ]);
  });
});

describe("LD10 defaults: destructive operations are off, everything else on", () => {
  it("resetMemberSpend is disabled by default: 403 OPERATION_DISABLED, no call", async () => {
    const ops = await load();
    await expect(
      ops.resetMemberSpend!(
        { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
        CTX,
      ),
    ).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(0);
  });

  it("deleteKey is disabled by default: 403 OPERATION_DISABLED, no call", async () => {
    const ops = await load();
    await expect(
      ops.deleteKey!({ tokenId: TOKEN_A }, CTX),
    ).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(0);
  });

  it("removeTeamMember is on by default (amended 2026-11-14)", async () => {
    const ops = await load();
    await ops.removeTeamMember!(
      { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
      CTX,
    );
    expect(fake.calls).toHaveLength(1);
  });

  it("reads are on by default", async () => {
    const ops = await load();
    await ops.getTeam!({ litellmTeamId: TEAM_ID });
    expect(fake.calls).toHaveLength(1);
  });
});

describe("saved OperationToggles (UI layer)", () => {
  it("a saved true enables a default-off operation", async () => {
    await storeToggles({ deleteKey: true });
    const ops = await load();
    await ops.deleteKey!({ tokenId: TOKEN_A }, CTX);
    expect(fake.calls).toHaveLength(1);
  });

  it("a disabled write returns 403 OPERATION_DISABLED before any call", async () => {
    await storeToggles({ createTeam: false });
    const ops = await load();
    await expect(
      ops.createTeam!({ teamAlias: "A", dashboardTeamId: "team-a" }, CTX),
    ).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(0);
  });

  it.each([
    ["getTeam", (o: Ops) => o.getTeam!({ litellmTeamId: TEAM_ID })],
    ["listProxyTeams", (o: Ops) => o.listProxyTeams!()],
    ["getUser", (o: Ops) => o.getUser!({ litellmUserId: USER_ID })],
    ["listKeys", (o: Ops) => o.listKeys!({ litellmTeamId: TEAM_ID })],
    ["listProxyModels", (o: Ops) => o.listProxyModels!()],
    [
      "listProxyAuditLog",
      (o: Ops) =>
        o.listProxyAuditLog!({
          startDate: "2026-11-01",
          endDate: "2026-11-14",
        }),
    ],
  ])(
    "a disabled read (%s) returns 403 OPERATION_DISABLED before any call (LD19)",
    async (name, run) => {
      await storeToggles({ [name]: false });
      const ops = await load();
      await expect(run(ops)).rejects.toMatchObject(DISABLED);
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("disabling one operation leaves the others working", async () => {
    await storeToggles({ getTeam: false });
    const ops = await load();
    await expect(
      ops.getTeam!({ litellmTeamId: TEAM_ID }),
    ).rejects.toMatchObject(DISABLED);
    await ops.getUser!({ litellmUserId: USER_ID });
    expect(fake.calls).toHaveLength(1);
  });

  it("a disabled member write blocks the whole composed operation, including its lookups (disableMember)", async () => {
    await storeToggles({ disableMember: false });
    const ops = await load();
    await expect(
      ops.disableMember!(
        { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
        CTX,
      ),
    ).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(0);
  });

  it("toggles narrow only: a saved name outside the allowlist neither adds an operation nor breaks the others", async () => {
    await storeToggles({ deleteTeam: true, "/team/delete": true });
    const ops = await load();
    expect(ops.deleteTeam).toBeUndefined();
    await ops.getTeam!({ litellmTeamId: TEAM_ID });
    expect(fake.calls).toHaveLength(1);
  });
});

describe("config file layer and precedence UI > file > LD10", () => {
  it("a file entry enabled:false disables an operation that LD10 enables", async () => {
    const ops = await load({}, { createTeam: { enabled: false } });
    await expect(
      ops.createTeam!({ teamAlias: "A", dashboardTeamId: "team-a" }, CTX),
    ).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(0);
  });

  it("a file entry enabled:false disables a read", async () => {
    const ops = await load({}, { getTeam: { enabled: false } });
    await expect(
      ops.getTeam!({ litellmTeamId: TEAM_ID }),
    ).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(0);
  });

  it("a file entry enabled:true enables a default-off operation", async () => {
    const ops = await load({}, { deleteKey: { enabled: true } });
    await ops.deleteKey!({ tokenId: TOKEN_A }, CTX);
    expect(fake.calls).toHaveLength(1);
  });

  it("a saved UI value overrides the file in both directions", async () => {
    await storeToggles({ createTeam: true, deleteKey: false });
    const ops = await load(
      {},
      { createTeam: { enabled: false }, deleteKey: { enabled: true } },
    );
    await ops.createTeam!({ teamAlias: "A", dashboardTeamId: "team-a" }, CTX);
    expect(fake.calls).toHaveLength(1);
    await expect(
      ops.deleteKey!({ tokenId: TOKEN_A }, CTX),
    ).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(1);
  });

  it("an operation absent from both layers follows LD10", async () => {
    const ops = await load({}, { createTeam: { enabled: false } });
    await expect(
      ops.resetMemberSpend!(
        { litellmTeamId: TEAM_ID, litellmUserId: USER_ID },
        CTX,
      ),
    ).rejects.toMatchObject(DISABLED);
    await ops.blockKey!({ tokenId: TOKEN_A }, CTX);
    expect(fake.calls).toHaveLength(1);
  });
});
