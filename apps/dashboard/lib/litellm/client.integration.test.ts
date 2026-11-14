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
import type { FakeHandler } from "@/test/fake-litellm";
import {
  clearTable,
  ensureTestTable,
  testDoc,
  TEST_TABLE_NAME,
} from "@/test/test-support";

// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" items
// 1, 5, 7, 8 (base URL from the stored connection, allowlist, https in prod,
// 10 s timeout, GET retries <= 2, writes never retried, sanitised errors,
// 401 never retried), threats LT1, LT6, LT12; implementation-phases L1 task 3.
// Nothing reaches the network: `fetch` is the in-process fake (Rule 60.24).
const KEY = "sk-fake-key-000";
const SENTINEL = "UPSTREAM-LEAK-SENTINEL-1";
const BASE = "http://litellm.test:4000";

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  const vars = {
    APP_ENV: "dev",
    LITELLM_ALLOWED_HOSTS: "litellm.test:4000",
    LITELLM_SERVICE_KEY: KEY,
    ...env,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  return import("./client");
}

async function storeConnection(baseUrl: string) {
  await testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: {
        PK: "LITELLM#CONFIG",
        SK: "CONNECTION",
        baseUrl,
        version: 1,
        updatedAt: "2026-11-14T10:00:00.000Z",
      },
    }),
  );
}

let fake: ReturnType<typeof createFakeLiteLLM>;
function installFake(handler?: FakeHandler) {
  fake = createFakeLiteLLM(handler);
  vi.stubGlobal("fetch", fake.fetch);
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  installFake((call) => ({ status: 200, body: { ok: call.path } }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("callLiteLLM — base URL, allowlist and credentials", () => {
  it("calls the base URL stored in the connection with the service key as a Bearer token", async () => {
    await storeConnection(BASE);
    const { callLiteLLM } = await load();
    const res = await callLiteLLM({ method: "GET", path: "/team/list" });
    expect(res.status).toBe(200);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe(`${BASE}/team/list`);
    expect(fake.calls[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("does not follow redirects (the key must not follow a 3xx to another host)", async () => {
    await storeConnection(BASE);
    const { callLiteLLM } = await load();
    await callLiteLLM({ method: "GET", path: "/team/list" });
    expect(["error", "manual"]).toContain(fake.calls[0]?.redirect);
  });

  it("sends a JSON body with a JSON content type on writes", async () => {
    await storeConnection(BASE);
    const { callLiteLLM } = await load();
    await callLiteLLM({ method: "POST", path: "/team/new", body: { a: 1 } });
    expect(fake.calls[0]?.body).toEqual({ a: 1 });
    expect(fake.calls[0]?.headers["content-type"]).toMatch(/application\/json/);
  });

  it("is 'not configured' (LITELLM_UNAVAILABLE) with no call when no connection is stored", async () => {
    const { callLiteLLM } = await load();
    await expect(
      callLiteLLM({ method: "GET", path: "/team/list" }),
    ).rejects.toMatchObject({
      code: "LITELLM_UNAVAILABLE",
      detail: "not_configured",
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("is 'not configured' with no call when the service key is missing or empty", async () => {
    await storeConnection(BASE);
    const { callLiteLLM } = await load({ LITELLM_SERVICE_KEY: "" });
    await expect(
      callLiteLLM({ method: "GET", path: "/team/list" }),
    ).rejects.toMatchObject({ detail: "not_configured" });
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a stored URL whose host is not in LITELLM_ALLOWED_HOSTS, with no call (LT6)", async () => {
    await storeConnection("http://evil.test:4000");
    const { callLiteLLM } = await load();
    await expect(
      callLiteLLM({ method: "GET", path: "/team/list" }),
    ).rejects.toMatchObject({ code: "LITELLM_UNAVAILABLE" });
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses an http URL when APP_ENV=prod, with no call", async () => {
    await storeConnection(BASE);
    const { callLiteLLM } = await load({ APP_ENV: "prod" });
    await expect(
      callLiteLLM({ method: "GET", path: "/team/list" }),
    ).rejects.toMatchObject({ code: "LITELLM_UNAVAILABLE" });
    expect(fake.calls).toHaveLength(0);
  });

  it.each([
    "http://user:pw@litellm.test:4000",
    "http://litellm.test:4000?x=1",
    "http://litellm.test:4000#f",
  ])(
    "refuses a stored URL with userinfo, query or fragment (%s), with no call",
    async (url) => {
      await storeConnection(url);
      const { callLiteLLM } = await load();
      await expect(
        callLiteLLM({ method: "GET", path: "/team/list" }),
      ).rejects.toMatchObject({ code: "LITELLM_UNAVAILABLE" });
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("an explicit baseUrl option (used to probe a candidate) obeys the same allowlist and scheme rules", async () => {
    const { callLiteLLM } = await load();
    await expect(
      callLiteLLM(
        { method: "GET", path: "/team/list" },
        { baseUrl: "http://evil.test:4000" },
      ),
    ).rejects.toMatchObject({ code: "LITELLM_UNAVAILABLE" });
    expect(fake.calls).toHaveLength(0);
    await callLiteLLM({ method: "GET", path: "/team/list" }, { baseUrl: BASE });
    expect(fake.calls).toHaveLength(1);
  });
});

describe("callLiteLLM — failure mapping and sanitisation (LT1, LT12)", () => {
  it.each([
    [401, "unauthorised"],
    [403, "routes_out_of_date"],
    [500, "upstream_error"],
    [404, "upstream_error"],
  ] as const)(
    "maps upstream %s to LITELLM_UNAVAILABLE with detail %s",
    async (status, detail) => {
      installFake(() => ({ status, body: { detail: SENTINEL } }));
      const { callLiteLLM } = await load();
      await expect(
        callLiteLLM(
          { method: "POST", path: "/team/new", body: {} },
          { baseUrl: BASE },
        ),
      ).rejects.toMatchObject({ code: "LITELLM_UNAVAILABLE", detail });
    },
  );

  it("never carries an upstream body, the service key or a stack with either in the error", async () => {
    installFake(() => ({ status: 500, body: { detail: SENTINEL, key: KEY } }));
    const { callLiteLLM } = await load();
    const error = await callLiteLLM(
      { method: "POST", path: "/team/new", body: {} },
      { baseUrl: BASE },
    ).catch((e: unknown) => e);
    const dump = [
      String(error),
      JSON.stringify(error, Object.getOwnPropertyNames(error as object)),
    ].join("\n");
    expect(dump).not.toContain(SENTINEL);
    expect(dump).not.toContain(KEY);
  });

  it("maps a network failure to LITELLM_UNAVAILABLE 'unreachable' without leaking the key", async () => {
    installFake(() => "network-error");
    const { callLiteLLM } = await load();
    vi.installFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const assertion = expect(
      callLiteLLM({ method: "POST", path: "/x", body: {} }, { baseUrl: BASE }),
    ).rejects.toMatchObject({
      code: "LITELLM_UNAVAILABLE",
      detail: "unreachable",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it("writes no log line containing the key or an upstream body", async () => {
    installFake(() => ({ status: 500, body: { detail: SENTINEL } }));
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (m) => vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const { callLiteLLM } = await load();
    await callLiteLLM(
      { method: "POST", path: "/team/new", body: {} },
      { baseUrl: BASE },
    ).catch(() => {});
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(SENTINEL);
  });
});

describe("callLiteLLM — timeout and retries", () => {
  beforeEach(() => {
    vi.installFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  it("aborts a request after 10 s (not before) with detail 'timeout'", async () => {
    installFake(() => "hang");
    const { callLiteLLM } = await load();
    let settled = false;
    const p = callLiteLLM(
      { method: "POST", path: "/team/new", body: {} },
      { baseUrl: BASE },
    );
    const assertion = expect(p).rejects.toMatchObject({
      code: "LITELLM_UNAVAILABLE",
      detail: "timeout",
    });
    void p.catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fake.calls).toHaveLength(1);
  });

  it("retries a GET at most twice (3 attempts) on a 5xx and succeeds when a retry works", async () => {
    installFake((_c, attempt) =>
      attempt < 3 ? { status: 503 } : { status: 200, body: { ok: true } },
    );
    const { callLiteLLM } = await load();
    const p = callLiteLLM(
      { method: "GET", path: "/team/list" },
      { baseUrl: BASE },
    );
    const assertion = expect(p).resolves.toMatchObject({ status: 200 });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fake.calls).toHaveLength(3);
  });

  it("gives up after 3 GET attempts in total", async () => {
    installFake(() => ({ status: 503 }));
    const { callLiteLLM } = await load();
    const p = callLiteLLM(
      { method: "GET", path: "/team/list" },
      { baseUrl: BASE },
    );
    const assertion = expect(p).rejects.toMatchObject({
      code: "LITELLM_UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(fake.calls).toHaveLength(3);
  });

  it("waits between GET retries (backoff), not hammering back to back", async () => {
    installFake(() => ({ status: 503 }));
    const { callLiteLLM } = await load();
    const p = callLiteLLM(
      { method: "GET", path: "/team/list" },
      { baseUrl: BASE },
    );
    const assertion = expect(p).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "never retries a %s on a 5xx or a network failure",
    async (method) => {
      installFake(() => ({ status: 503 }));
      const { callLiteLLM } = await load();
      const p = callLiteLLM(
        { method, path: "/team/new", body: {} },
        { baseUrl: BASE },
      );
      const assertion = expect(p).rejects.toBeDefined();
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
      expect(fake.calls).toHaveLength(1);
    },
  );

  it("never retries a 401 (rotate and redeploy, never another key), even for a GET", async () => {
    installFake(() => ({ status: 401 }));
    const { callLiteLLM } = await load();
    const p = callLiteLLM(
      { method: "GET", path: "/team/list" },
      { baseUrl: BASE },
    );
    const assertion = expect(p).rejects.toMatchObject({
      detail: "unauthorised",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(fake.calls).toHaveLength(1);
  });

  it("does not retry a GET on a 403 or 404", async () => {
    for (const status of [403, 404]) {
      installFake(() => ({ status }));
      const { callLiteLLM } = await load();
      const p = callLiteLLM(
        { method: "GET", path: "/team/list" },
        { baseUrl: BASE },
      );
      const assertion = expect(p).rejects.toBeDefined();
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
      expect(fake.calls).toHaveLength(1);
    }
  });
});
