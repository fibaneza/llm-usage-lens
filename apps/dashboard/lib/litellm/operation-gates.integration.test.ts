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

import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import {
  TEAM_ID,
  TOKEN_A,
  USER_ID,
  gatewayHandler,
} from "@/test/fakes/fake-litellm-gateway";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-litellm.md — "Toggles narrow only" (a
// disabled operation returns 403 OPERATION_DISABLED before any LiteLLM call,
// writes and, since LD19, reads), "Edition" (Enterprise-only operations return
// 403 OPERATION_UNAVAILABLE on OSS with no call; edition from APP_ENV),
// "Guardrail configuration" precedence (amended 2026-11-17, unit CFG, user
// decision D1: config file > saved OperationToggles > LD10 for an operation the
// file sets; saved > LD10 otherwise), decision LD10 (resetMemberSpend and deleteKey default off), threat
// LT15; implementation-phases L2 Verify.
//
// Contract: operations throw an error with `{ code, status: 403 }` where code
// is "OPERATION_DISABLED" or "OPERATION_UNAVAILABLE" (class
// LiteLLMOperationRefused, exported from lib/litellm/gateway.ts), thrown before
// any request. The file defaults come from `loadGatewayConfig()` in
// lib/litellm/gateway-config.ts (mocked here to control the file layer).
// read-views pulls in the Auth.js session chain through the route guard.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

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
});

// Source: docs/specs/2026-11-10-litellm.md - Writes: `createUser` ("Edition
// gate first: on Enterprise it returns 403 OPERATION_UNAVAILABLE with no call";
// toggle default on), LT-MI1 ("Enterprise 403 OPERATION_UNAVAILABLE, no
// /user/new"), "Security architecture" item 2 (toggle -> edition -> validation).
describe("createUser gates (LT-MI1)", () => {
  const input = { email: "jane@company.com" };

  it("on Enterprise it is 403 OPERATION_UNAVAILABLE with no LiteLLM call at all, not even the lookup", async () => {
    install({ edition: "enterprise" });
    const ops = await load({ APP_ENV: "prod" });
    await expect(ops.createUser!(input, CTX)).rejects.toMatchObject(
      UNAVAILABLE,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("on Enterprise the edition refusal comes before input validation", async () => {
    const ops = await load({ APP_ENV: "prod" });
    await expect(ops.createUser!({}, CTX)).rejects.toMatchObject(UNAVAILABLE);
    expect(fake.calls).toHaveLength(0);
  });

  it("the toggle defaults on: with nothing stored, OSS creates the user", async () => {
    install({ userExists: false });
    const ops = await load();
    await ops.createUser!(input, CTX);
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /user/list",
      "POST /user/new",
    ]);
  });

  it("a saved off toggle is 403 OPERATION_DISABLED with no call, even with invalid input", async () => {
    await storeToggles({ createUser: false });
    const ops = await load();
    await expect(ops.createUser!({}, CTX)).rejects.toMatchObject(DISABLED);
    await expect(ops.createUser!(input, CTX)).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(0);
  });

  it("the config file can switch it off (file > saved > default)", async () => {
    const ops = await load({}, { createUser: { enabled: false } });
    await expect(ops.createUser!(input, CTX)).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(0);
  });

  it("a disabled searchUsers also blocks the no-search list (LD19)", async () => {
    await storeToggles({ searchUsers: false });
    const ops = await load();
    await expect(ops.searchUsers!({ page: 1 })).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(0);
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

  it("resetUserSpend is disabled by default (RS2, D-RS2; LD10): 403 OPERATION_DISABLED, no call", async () => {
    const ops = await load();
    await expect(
      ops.resetUserSpend!({ litellmUserId: USER_ID }, CTX),
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
    ["searchUsers", (o: Ops) => o.searchUsers!({ search: "jane" })],
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

describe("config file layer and precedence file > UI > LD10 (D1, unit CFG)", () => {
  it("a file entry enabled:false disables an operation that LD10 enables", async () => {
    const ops = await load({}, { createTeam: { enabled: false } });
    await expect(
      ops.createTeam!({ teamAlias: "A", dashboardTeamId: "team-a" }, CTX),
    ).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(0);
  });

  it("a saved value cannot re-enable an operation the file switched off (D1, Q1); it still overrides LD10 elsewhere", async () => {
    await storeToggles({ createTeam: true, deleteKey: true, blockKey: false });
    const ops = await load({}, { createTeam: { enabled: false } });
    await expect(
      ops.createTeam!({ teamAlias: "A", dashboardTeamId: "team-a" }, CTX),
    ).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(0);
    await ops.deleteKey!({ tokenId: TOKEN_A }, CTX);
    expect(fake.calls).toHaveLength(1);
    await expect(
      ops.blockKey!({ tokenId: TOKEN_A }, CTX),
    ).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(1);
  });
});

// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" item 2 (gate
// order: toggle -> edition -> input validation); moved from the L2 review file.
describe("gate order is toggle -> edition -> input validation (Security architecture item 2)", () => {
  const BAD: Array<[string, unknown]> = [
    ["createTeam", {}],
    ["setTeamBudget", { litellmTeamId: "../x", maxBudget: -1 }],
    ["getTeam", { litellmTeamId: "" }],
    ["getKey", { tokenId: "not-a-hash" }],
    ["deleteKey", { tokenId: "not-a-hash", extra: 1 }],
    ["rotateKey", { tokenId: "nope" }],
  ];

  it.each(BAD)(
    "%s disabled by its toggle with invalid input is 403 OPERATION_DISABLED, no call",
    async (name, input) => {
      await storeToggles({ [name]: false });
      const ops = await load();
      await expect(ops[name]!(input, CTX)).rejects.toMatchObject({
        code: "OPERATION_DISABLED",
        status: 403,
      });
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("an Enterprise-only operation on OSS with invalid input is OPERATION_UNAVAILABLE, not a validation error", async () => {
    const ops = await load();
    await expect(
      ops.getGlobalSpendReport!({ startDate: "nope", endDate: "nope" }),
    ).rejects.toMatchObject({ code: "OPERATION_UNAVAILABLE", status: 403 });
    expect(fake.calls).toHaveLength(0);
  });

  it("the toggle is checked before the edition: a disabled Enterprise-only operation on OSS is OPERATION_DISABLED", async () => {
    await storeToggles({ getGlobalSpendReport: false });
    const ops = await load();
    await expect(
      ops.getGlobalSpendReport!({
        startDate: "2026-11-01",
        endDate: "2026-11-02",
      }),
    ).rejects.toMatchObject({ code: "OPERATION_DISABLED", status: 403 });
    expect(fake.calls).toHaveLength(0);
  });

  it("valid input on an enabled operation still validates (bad input is a validation error)", async () => {
    const ops = await load();
    await expect(
      ops.getKey!({ tokenId: "not-a-hash" }),
    ).rejects.not.toMatchObject({ code: "OPERATION_DISABLED" });
    expect(fake.calls).toHaveLength(0);
  });
});

// Source: docs/specs/2026-11-10-litellm.md - `createUser` row ("OSS only") and
// "Edition gate first: on Enterprise it returns 403 OPERATION_UNAVAILABLE", LT-MI1;
// the read routes' enabledOperations drives which actions the UI offers, so it
// must not list createUser on Enterprise (no "Create and link" there).
describe("enabledOperations and createUser (LT-MI1)", () => {
  async function enabled(appEnv: "dev" | "prod") {
    await load({ APP_ENV: appEnv });
    const { enabledOperations } = await import("./read-views");
    return enabledOperations();
  }

  it("Enterprise (APP_ENV=prod): createUser is absent even though its toggle defaults on", async () => {
    expect(await enabled("prod")).not.toContain("createUser");
  });

  it("OSS (APP_ENV=dev) with the default toggle on: createUser is present", async () => {
    expect(await enabled("dev")).toContain("createUser");
  });

  it("OSS with the toggle saved off: createUser is absent (toggles narrow only)", async () => {
    await storeToggles({ createUser: false });
    expect(await enabled("dev")).not.toContain("createUser");
  });
});

// Source: docs/specs/2026-11-10-litellm.md - the LW1 paragraph after
// `createUser` (`ssoOffOnly`, next to `ossOnly`: with SSO enabled the gate
// refuses createUser with OPERATION_UNAVAILABLE before any LiteLLM call, and
// "enabledOperations" no longer lists it; addTeamMember and removeTeamMember
// are unchanged), Access Control - "Create and link only without SSO"; threat
// T-LW1 (Access Control); Security architecture item 2 (toggle -> edition ->
// validation).
describe("createUser with SSO enabled (LW1, T-LW1)", () => {
  const SSO = {
    AUTH_MICROSOFT_ENTRA_ID_ID: "00000000-0000-4000-8000-000000000001",
  };
  const input = { email: "jane@company.com" };

  it("is 403 OPERATION_UNAVAILABLE on OSS with no LiteLLM call at all, not even the lookup", async () => {
    const ops = await load(SSO);
    await expect(ops.createUser!(input, CTX)).rejects.toMatchObject(
      UNAVAILABLE,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("the SSO refusal comes before input validation, as the edition refusal does", async () => {
    const ops = await load(SSO);
    await expect(ops.createUser!({}, CTX)).rejects.toMatchObject(UNAVAILABLE);
    expect(fake.calls).toHaveLength(0);
  });

  it("a saved off toggle is still reported first: OPERATION_DISABLED (toggle, then the availability gates)", async () => {
    await storeToggles({ createUser: false });
    const ops = await load(SSO);
    await expect(ops.createUser!(input, CTX)).rejects.toMatchObject(DISABLED);
    expect(fake.calls).toHaveLength(0);
  });

  it("SSO off (the variable empty) still creates the user on OSS (T-LW2: works as today)", async () => {
    install({ userExists: false });
    const ops = await load({ AUTH_MICROSOFT_ENTRA_ID_ID: "" });
    await ops.createUser!(input, CTX);
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /user/list",
      "POST /user/new",
    ]);
  });

  it("enabledOperations omits createUser with SSO on and keeps addTeamMember and removeTeamMember (T-LW1 button absent; T-LW3)", async () => {
    await load({ APP_ENV: "dev", ...SSO });
    const { enabledOperations } = await import("./read-views");
    const enabled = await enabledOperations();
    expect(enabled).not.toContain("createUser");
    expect(enabled).toContain("addTeamMember");
    expect(enabled).toContain("removeTeamMember");
  });

  it("enabledOperations lists createUser with SSO off on OSS (T-LW2: the button is offered)", async () => {
    await load({ APP_ENV: "dev", AUTH_MICROSOFT_ENTRA_ID_ID: "" });
    const { enabledOperations } = await import("./read-views");
    expect(await enabledOperations()).toContain("createUser");
  });
});

// Source: docs/specs/2026-11-10-litellm.md - the LW1 paragraph after
// `createUser`, tests T-LW1 / T-LW4; LW1 coordinator ruling (2026-11-24): the
// gate is the enforcement and enabledOperations() answers from the same
// predicate (`operationUnavailable`), so the view can never disagree with it.
describe("enabledOperations is pinned to the gate (LW1 ruling, T-LW4)", () => {
  const SSO_ON = "00000000-0000-4000-8000-000000000001";
  const cases = [
    { edition: "oss", appEnv: "dev", sso: false },
    { edition: "oss", appEnv: "dev", sso: true },
    { edition: "enterprise", appEnv: "prod", sso: false },
    { edition: "enterprise", appEnv: "prod", sso: true },
  ] as const;

  it.each(cases)(
    "$edition, SSO $sso: lists an operation iff its toggle is on and operationUnavailable is false",
    async ({ appEnv, sso }) => {
      const { LITELLM_OPERATION_NAMES } =
        await import("@llm-usage-lens/shared");
      // Alternate on and off so both toggle states are crossed with the gate.
      const toggles = Object.fromEntries(
        LITELLM_OPERATION_NAMES.map((name, i) => [name, i % 2 === 0]),
      );
      await storeToggles(toggles);
      const ops = (await load(
        {
          APP_ENV: appEnv,
          AUTH_MICROSOFT_ENTRA_ID_ID: sso ? SSO_ON : "",
        },
        {},
      )) as unknown as {
        operationUnavailable: (n: string, e: string) => boolean;
      };
      const { enabledOperations } = await import("./read-views");
      const enabled = await enabledOperations();
      const edition = appEnv === "prod" ? "enterprise" : "oss";
      const expected = LITELLM_OPERATION_NAMES.filter(
        (name) =>
          toggles[name] === true && !ops.operationUnavailable(name, edition),
      );
      expect(enabled.slice().sort()).toEqual(expected.slice().sort());
    },
  );
});

// Source: docs/specs/2026-11-10-litellm.md - MG-D11a (`requestBudgetReset` is a
// route-less dashboard operation, default on; `enabledOperations()` must not
// treat an operation with no routes as Enterprise-only on OSS, because
// `[].every(...)` is true) and the LW1 coordinator ruling (one predicate, so
// the view never disagrees with the gate).
describe("route-less requestBudgetReset stays available (MG-D11a, LW1 ruling)", () => {
  const SSO_ON = "00000000-0000-4000-8000-000000000001";
  const cells = [
    { edition: "oss", appEnv: "dev", sso: false },
    { edition: "oss", appEnv: "dev", sso: true },
    { edition: "enterprise", appEnv: "prod", sso: false },
    { edition: "enterprise", appEnv: "prod", sso: true },
  ] as const;

  it.each(cells)(
    "$edition, SSO $sso: enabledOperations() lists requestBudgetReset with its default-on toggle",
    async ({ appEnv, sso }) => {
      await load({
        APP_ENV: appEnv,
        AUTH_MICROSOFT_ENTRA_ID_ID: sso ? SSO_ON : "",
      });
      const { enabledOperations } = await import("./read-views");
      expect(await enabledOperations()).toContain("requestBudgetReset");
    },
  );

  it("a saved off toggle removes it (toggles narrow only)", async () => {
    await storeToggles({ requestBudgetReset: false });
    await load({ APP_ENV: "dev" });
    const { enabledOperations } = await import("./read-views");
    expect(await enabledOperations()).not.toContain("requestBudgetReset");
  });

  it.each(["oss", "enterprise"] as const)(
    "operationUnavailable(requestBudgetReset, %s) is false, with and without SSO",
    async (edition) => {
      for (const sso of ["", SSO_ON]) {
        const ops = (await load({
          APP_ENV: edition === "oss" ? "dev" : "prod",
          AUTH_MICROSOFT_ENTRA_ID_ID: sso,
        })) as unknown as {
          operationUnavailable: (n: string, e: string) => boolean;
        };
        expect(ops.operationUnavailable("requestBudgetReset", edition)).toBe(
          false,
        );
      }
    },
  );

  // Independent of operationUnavailable: a hand-listed set per cell, so the
  // pinned table above cannot pass by comparing the predicate with itself.
  // Allowlist facts: listProxyAuditLog and getGlobalSpendReport have only
  // Enterprise routes; createUser is ossOnly + ssoOffOnly; rotateKey has an
  // OSS route, so it is available on OSS.
  const ENTERPRISE_ONLY = ["getGlobalSpendReport", "listProxyAuditLog"];
  it.each(cells)(
    "$edition, SSO $sso: with every toggle on, enabledOperations() equals the hand-listed set",
    async ({ edition, appEnv, sso }) => {
      const { LITELLM_OPERATION_NAMES } =
        await import("@llm-usage-lens/shared");
      await storeToggles(
        Object.fromEntries(LITELLM_OPERATION_NAMES.map((n) => [n, true])),
      );
      await load(
        {
          APP_ENV: appEnv,
          AUTH_MICROSOFT_ENTRA_ID_ID: sso ? SSO_ON : "",
        },
        {},
      );
      const { enabledOperations } = await import("./read-views");
      const missing = new Set<string>();
      if (edition === "oss") ENTERPRISE_ONLY.forEach((n) => missing.add(n));
      if (edition === "enterprise" || sso) missing.add("createUser");
      const expected = LITELLM_OPERATION_NAMES.filter((n) => !missing.has(n));
      expect((await enabledOperations()).slice().sort()).toEqual(
        expected.slice().sort(),
      );
    },
  );
});
