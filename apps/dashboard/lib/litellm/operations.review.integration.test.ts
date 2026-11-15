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
  NEW_TOKEN,
  OTHER_TEAM_ID,
  OTHER_USER_ID,
  TEAM_ID,
  TOKEN_A,
  USER_ID,
  gatewayHandler,
} from "@/test/fake-litellm-gateway";
import type { GatewayFakeOptions } from "@/test/fake-litellm-gateway";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/test-support";

// Source: docs/specs/2026-11-10-litellm.md — the `rotateKey` row (OSS
// carry-over, L2 review 2026-11-15: team_id/user_id must match or the
// rotation is refused with no write; `models` carried exactly, any
// unparseable old model refuses as contract drift with no write; expiry and
// blocked state carried), "Security architecture" item 2 (gate order: toggle
// -> edition -> input validation), "Gateway guardrails" item 4, threats LT4,
// LT7, LT14; Rule 60.17 (no silent failures).
const KEY = "sk-fake-key-000";
const CTX = { actor: { oid: "oid-actor-1", email: "admin@company.com" } };
const NOW = "2026-11-14T10:00:00.000Z";

type Ops = Record<string, (input?: unknown, ctx?: unknown) => Promise<unknown>>;

async function load(): Promise<Ops> {
  vi.resetModules();
  const vars = {
    APP_ENV: "dev",
    AUTH_ACCESS_MODE: "enforce",
    LITELLM_ALLOWED_HOSTS: "litellm.test:4000",
    LITELLM_SERVICE_KEY: KEY,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  return (await import("./operations")) as unknown as Ops;
}

async function putConfig(sk: string, item: Record<string, unknown>) {
  await testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: {
        PK: "LITELLM#CONFIG",
        SK: sk,
        version: 1,
        updatedAt: NOW,
        ...item,
      },
    }),
  );
}
const storeConnection = () =>
  putConfig("CONNECTION", { baseUrl: "http://litellm.test:4000" });
const storeToggles = (toggles: Record<string, boolean>) =>
  putConfig("TOGGLES", { toggles });

let fake: ReturnType<typeof createFakeLiteLLM>;
function install(opts: GatewayFakeOptions = {}) {
  fake = createFakeLiteLLM(gatewayHandler(opts));
  vi.stubGlobal("fetch", fake.fetch);
}
const writes = () => fake.calls.filter((c) => c.method === "POST");

beforeAll(ensureTestTable);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  await clearTable();
  await storeConnection();
  install();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ROTATE_BASE = {
  litellmTeamId: TEAM_ID,
  litellmUserId: USER_ID,
  dashboardTeamId: "team-a",
};
const ROTATE = {
  tokenId: TOKEN_A,
  litellmTeamId: TEAM_ID,
  litellmUserId: USER_ID,
  dashboardTeamId: "team-a",
};

describe("OSS rotateKey carries the old key's models exactly (LT4, LT14)", () => {
  it("the new key's models are the old key's list, in order", async () => {
    install({
      keyInfo: { models: ["claude-sonnet", "claude-haiku"] },
      teamModels: ["claude-sonnet", "claude-haiku"],
      proxyModels: ["claude-sonnet", "claude-haiku"],
    });
    const ops = await load();
    await ops.rotateKey!(ROTATE, CTX);
    const generate = writes().find((c) => c.path === "/key/generate")!;
    expect((generate.body as { models?: unknown }).models).toEqual([
      "claude-sonnet",
      "claude-haiku",
    ]);
  });

  it.each([
    ["one bad name among good ones", ["claude-sonnet", "bad name!"]],
    ["a widening name among good ones", ["claude-sonnet", "all-team-models"]],
    ["every name unparseable", ["bad name!", "also/../bad name"]],
    ["an over-long name", ["a".repeat(201)]],
  ])(
    "refuses as contract drift with no write when the old models contain %s",
    async (_n, models) => {
      install({ keyInfo: { models } });
      const ops = await load();
      const err = await ops.rotateKey!(ROTATE, CTX).catch((e: unknown) => e);
      expect(err).toMatchObject({
        code: "LITELLM_UNAVAILABLE",
        detail: "contract_drift",
      });
      expect(writes()).toHaveLength(0);
    },
  );
});

describe("OSS rotateKey carries expiry and blocked state, and checks ownership", () => {
  it("the new key takes the old key's remaining lifetime", async () => {
    install({
      keyInfo: {
        models: ["claude-sonnet"],
        expires: "2026-12-14T10:00:00.000Z",
      },
    });
    const ops = await load();
    await ops.rotateKey!(ROTATE, CTX);
    const generate = writes().find((c) => c.path === "/key/generate")!;
    // 30 days from the frozen clock, in any whole unit the Duration schema allows.
    expect((generate.body as { duration?: string }).duration).toMatch(
      /^(30d|720h)$/,
    );
  });

  it("a key without an expiry gives the new key no duration", async () => {
    install({ keyInfo: { models: ["claude-sonnet"], expires: null } });
    const ops = await load();
    await ops.rotateKey!(ROTATE, CTX);
    const generate = writes().find((c) => c.path === "/key/generate")!;
    expect((generate.body as { duration?: unknown }).duration).toBeUndefined();
  });

  it("a blocked old key: generate (no `blocked` in the body), block the new key, then block the old key (rotateKey row, LT4)", async () => {
    install({ keyInfo: { models: ["claude-sonnet"], blocked: true } });
    const ops = await load();
    await ops.rotateKey!(ROTATE, CTX);
    const sequence = writes().map((c) => [
      c.path,
      (c.body as { key?: string }).key,
    ]);
    expect(sequence).toEqual([
      ["/key/generate", undefined],
      ["/key/block", NEW_TOKEN],
      ["/key/block", TOKEN_A],
    ]);
    expect("blocked" in (writes()[0]!.body as Record<string, unknown>)).toBe(
      false,
    );
  });

  it("an unblocked old key does not mark the new key blocked", async () => {
    install({ keyInfo: { models: ["claude-sonnet"], blocked: false } });
    const ops = await load();
    await ops.rotateKey!(ROTATE, CTX);
    const generate = writes().find((c) => c.path === "/key/generate")!;
    expect([undefined, false]).toContainEqual(
      (generate.body as { blocked?: unknown }).blocked,
    );
  });

  it.each([
    ["another team", { team_id: OTHER_TEAM_ID }],
    ["another user", { user_id: OTHER_USER_ID }],
    ["no team", { team_id: null }],
  ])(
    "refuses with no write when the old key belongs to %s",
    async (_n, owner) => {
      install({ keyInfo: { models: ["claude-sonnet"], ...owner } });
      const ops = await load();
      await expect(ops.rotateKey!(ROTATE, CTX)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(writes()).toHaveLength(0);
    },
  );
});

// rotateKey row (spec audit 2026-11-15): expiry is the remaining life rounded
// DOWN to the duration unit, capped at the ceiling; no expiry stays none.
describe("OSS rotateKey expiry rounds down and is capped (rotateKey row)", () => {
  const duration = async (expires: string) => {
    install({ keyInfo: { models: ["claude-sonnet"], expires } });
    const ops = await load();
    await ops.rotateKey!(ROTATE, CTX);
    return (
      writes().find((c) => c.path === "/key/generate")!.body as {
        duration?: string;
      }
    ).duration;
  };

  it.each([
    [
      "30 days 12 hours left is 30d, not 31d",
      "2026-12-14T22:00:00.000Z",
      "30d",
    ],
    ["1 hour 30 minutes left is 1h, not 2h", "2026-11-14T11:30:00.000Z", "1h"],
  ])("%s", async (_n, expires, expected) => {
    const got = await duration(expires);
    expect(got).toBe(expected);
  });

  it("a life beyond the 4-digit duration ceiling is capped at 9999d", async () => {
    expect(await duration("2100-01-01T00:00:00.000Z")).toBe("9999d");
  });
});

// rotateKey row: the copied models are re-checked against the current team
// models and /models (LT14); a mismatch is 409 CONFLICT with no write.
describe("OSS rotateKey re-checks the copied models (LT14)", () => {
  it.each([
    [
      "a model the team no longer has",
      {
        teamModels: ["claude-sonnet"],
        proxyModels: ["claude-sonnet", "claude-opus"],
      },
    ],
    [
      "a model the proxy no longer lists",
      {
        teamModels: ["claude-sonnet", "claude-opus"],
        proxyModels: ["claude-sonnet"],
      },
    ],
  ])(
    "refuses with 409 CONFLICT and no write when the old key has %s",
    async (_n, drift) => {
      install({
        keyInfo: { models: ["claude-sonnet", "claude-opus"] },
        ...drift,
      });
      const ops = await load();
      await expect(ops.rotateKey!(ROTATE, CTX)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(writes()).toHaveLength(0);
    },
  );
});

// Writes table + LT4: `blocked` is no field of the /key/generate builder.
describe("generateMemberKey does not accept `blocked` (LT4)", () => {
  it("rejects it with no call", async () => {
    const ops = await load();
    await expect(
      ops.generateMemberKey!(
        { ...ROTATE_BASE, models: ["claude-sonnet"], blocked: true },
        CTX,
      ),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });
});

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

describe("memberKeyTokens (disableMember / enableMember)", () => {
  const MEMBER = { litellmTeamId: TEAM_ID, litellmUserId: USER_ID };

  it.each(["disableMember", "enableMember"])(
    "%s throws instead of silently truncating when LiteLLM never reaches the last page (100-page cap)",
    async (name) => {
      const base = gatewayHandler();
      fake.setHandler((call, n) => {
        if (call.method === "GET" && call.path === "/key/list") {
          return {
            status: 200,
            body: {
              keys: [{ token: TOKEN_A, team_id: TEAM_ID, user_id: USER_ID }],
              total_count: 100_000,
              current_page: 1,
              total_pages: 1000,
            },
          };
        }
        return base(call, n);
      });
      const ops = await load();
      await expect(ops[name]!(MEMBER, CTX)).rejects.toBeDefined();
      expect(
        fake.calls.filter((c) => c.path === "/key/list").length,
      ).toBeLessThanOrEqual(100);
      expect(writes()).toHaveLength(0);
    },
  );

  it("exactly 100 pages that end on the last page is not an error", async () => {
    const base = gatewayHandler();
    fake.setHandler((call, n) => {
      if (call.method === "GET" && call.path === "/key/list") {
        return {
          status: 200,
          body: {
            keys: [],
            total_count: 0,
            current_page: 1,
            total_pages: 100,
          },
        };
      }
      return base(call, n);
    });
    const ops = await load();
    await expect(ops.disableMember!(MEMBER, CTX)).resolves.toEqual({
      tokenIds: [],
    });
  });

  it("a matching row whose token is not a token hash is contract drift (LITELLM_UNAVAILABLE), not a raw validation error", async () => {
    install({
      keys: [{ token: "sk-not-a-hash", team_id: TEAM_ID, user_id: USER_ID }],
    });
    const ops = await load();
    const err = await ops.disableMember!(MEMBER, CTX).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: "LITELLM_UNAVAILABLE",
      detail: "contract_drift",
    });
    expect((err as Error).name).toBe("LiteLLMError");
    expect(writes()).toHaveLength(0);
  });
});
