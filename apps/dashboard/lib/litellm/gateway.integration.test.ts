import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeLiteLLM } from "@/test/fake-litellm";
import { gatewayHandler } from "@/test/fake-litellm-gateway";
import { installFakeOtel, recordedSpans } from "@/test/otel-fake";

// Source: docs/specs/2026-11-10-litellm.md — "Gateway guardrails" items 1-4
// (one outbound choke point that checks method + route template against the
// allowlist before any network call and records LiteLLMRouteNotAllowed on the
// span; path parameters validated then encodeURIComponent-encoded; hard-limit
// denylist; no caller-supplied path), "Audit" item 2 / LD14 / LT19
// (litellm-changed-by built from the session, validated), "Edition" / LT15,
// threats LT3, LT7, LT14, LT19. Nothing reaches the network (Rule 60.24):
// `fetch` is the in-process fake; `baseUrl` is passed explicitly so the unit
// test needs no table.
const KEY = "sk-fake-key-000";
const BASE = "http://litellm.test:4000";
const T = "11111111-1111-4111-8111-111111111111";

let fake: ReturnType<typeof createFakeLiteLLM>;

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  const vars = {
    APP_ENV: "dev",
    LITELLM_ALLOWED_HOSTS: "litellm.test:4000",
    LITELLM_SERVICE_KEY: KEY,
    ...env,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  return import("./gateway");
}

beforeEach(() => {
  installFakeOtel();
  fake = createFakeLiteLLM(gatewayHandler());
  vi.stubGlobal("fetch", fake.fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ACTOR = { oid: "oid-1", email: "Jane.Doe@Company.com" };
const opts = { baseUrl: BASE };

describe("callAllowlisted — an allowed route", () => {
  it("sends the fixed method and path for a read template, with query values", async () => {
    const { callAllowlisted } = await load();
    await callAllowlisted(
      {
        method: "GET",
        template: "/team/info",
        query: { team_id: T, ignored: undefined },
      },
      opts,
    );
    expect(fake.calls).toHaveLength(1);
    const url = new URL(fake.calls[0]!.url);
    expect(fake.calls[0]!.method).toBe("GET");
    expect(url.pathname).toBe("/team/info");
    expect(url.searchParams.get("team_id")).toBe(T);
    expect(url.searchParams.has("ignored")).toBe(false);
    expect(fake.calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("fills a templated path with encodeURIComponent-encoded parameters (guardrail 2)", async () => {
    const { callAllowlisted } = await load();
    await callAllowlisted(
      {
        method: "POST",
        template: "/team/{team_id}/member/{user_id}/reset_budget",
        params: { team_id: T, user_id: "jane@company.com" },
        actor: ACTOR,
      },
      opts,
    );
    expect(fake.calls[0]!.path).toBe(
      `/team/${T}/member/jane%40company.com/reset_budget`,
    );
  });

  it("fills {key} with the token hash for regenerate (Enterprise)", async () => {
    fake = createFakeLiteLLM(gatewayHandler({ edition: "enterprise" }));
    vi.stubGlobal("fetch", fake.fetch);
    const { callAllowlisted } = await load({
      APP_ENV: "prod",
      LITELLM_ALLOWED_HOSTS: "litellm.test",
    });
    const token = "a".repeat(64);
    await callAllowlisted(
      {
        method: "POST",
        template: "/key/{key}/regenerate",
        params: { key: token },
        body: { grace_period: "24h" },
        actor: ACTOR,
      },
      { baseUrl: "https://litellm.test" },
    );
    expect(fake.calls[0]!.path).toBe(`/key/${token}/regenerate`);
    expect(fake.calls[0]!.body).toEqual({ grace_period: "24h" });
  });
});

describe("callAllowlisted — refusal before any network call (guardrail 1)", () => {
  it("exports LiteLLMRouteNotAllowed as an Error subclass", async () => {
    const { LiteLLMRouteNotAllowed } = await load();
    expect(new LiteLLMRouteNotAllowed("x")).toBeInstanceOf(Error);
  });

  it.each([
    [
      "a method the template does not allow (GET on a write)",
      "GET",
      "/team/new",
    ],
    ["DELETE on /team/update", "DELETE", "/team/update"],
    ["PUT on /key/block", "PUT", "/key/block"],
    ["PATCH on /team/info", "PATCH", "/team/info"],
    ["POST on a read-only route", "POST", "/user/info"],
    ["POST on /models", "POST", "/models"],
    [
      "a concrete path used as a template",
      "POST",
      `/team/${T}/member/jane/reset_spend`,
    ],
    [
      "a bare /team/{team_id} template (wildcard-only match)",
      "GET",
      "/team/{team_id}",
    ],
    ["a trailing-slash variant", "GET", "/team/info/"],
    ["a case variant", "GET", "/Team/Info"],
    ["a query smuggled in the template", "GET", "/team/info?team_id=x"],
    ["a full URL", "GET", "http://evil.test/team/info"],
    ["a double-slash path", "GET", "//team/info"],
    ["a relative path", "GET", "team/info"],
    ["an empty template", "GET", ""],
  ])(
    "throws LiteLLMRouteNotAllowed for %s, with no request",
    async (_n, method, template) => {
      const { callAllowlisted, LiteLLMRouteNotAllowed } = await load();
      await expect(
        callAllowlisted(
          { method: method as "GET", template, actor: ACTOR },
          opts,
        ),
      ).rejects.toBeInstanceOf(LiteLLMRouteNotAllowed);
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("records the refusal on the active span, never sending", async () => {
    const { callAllowlisted } = await load();
    const before = recordedSpans.length;
    await trace.getTracer("test").startActiveSpan("request", async (span) => {
      await expect(
        callAllowlisted(
          { method: "POST", template: "/team/delete", actor: ACTOR },
          opts,
        ),
      ).rejects.toThrow();
      span.end();
    });
    const span = recordedSpans.slice(before).find((s) => s.name === "request");
    expect(span?.exceptions.length).toBeGreaterThanOrEqual(1);
    expect(fake.calls).toHaveLength(0);
  });

  it("accepts no caller-supplied path field at all", async () => {
    const { callAllowlisted } = await load();
    await expect(
      callAllowlisted(
        {
          method: "GET",
          template: "/team/info",
          path: "/team/delete",
        } as never,
        opts,
      ),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });
});

// Gateway guardrails item 3 + Scope: every hard-limit route, through the
// choke point, refused with zero requests reaching the fake.
const HARD_LIMIT: Array<[string, string]> = [
  ["POST", "/team/delete"],
  ["POST", "/team/block"],
  ["POST", "/team/unblock"],
  ["POST", "/team/model/add"],
  ["POST", "/team/model/delete"],
  ["POST", "/team/permissions_update"],
  ["POST", "/team/permissions_bulk_update"],
  ["POST", "/team/bulk_member_add"],
  ["POST", "/team/key/bulk_update"],
  ["POST", "/key/bulk_update"],
  ["POST", "/user/bulk_update"],
  ["POST", "/key/regenerate"],
  ["POST", "/key/service-account/generate"],
  ["POST", "/user/update"],
  ["POST", "/user/delete"],
  ["POST", "/model/new"],
  ["POST", "/model/update"],
  ["POST", "/model/delete"],
  ["GET", "/model/info"],
  ["POST", "/config/update"],
  ["GET", "/config/yaml"],
  ["POST", "/global/spend/reset"],
  ["POST", "/organization/new"],
  ["POST", "/organization/update"],
  ["POST", "/organization/delete"],
  ["GET", "/v1/agents"],
  ["POST", "/v1/agents"],
  ["POST", "/guardrails/new"],
  ["POST", "/chat/completions"],
  ["POST", "/v1/chat/completions"],
  ["POST", "/key/{key}/rotate"],
  ["POST", "/team/{team_id}/delete"],
  ["DELETE", "/team/{team_id}"],
  ["POST", "/team/{team_id}/member/{user_id}/delete"],
  ["GET", "/key/{key}/regenerate"],
  ["GET", "/models/gpt:generateContent"],
  ["POST", "/models/claude:generateContent"],
  ["GET", "/audit/some-id"],
];

describe("hard-limit denylist (guardrail 3, LT3, LT7, LT14)", () => {
  it.each(HARD_LIMIT)(
    "refuses %s %s with no request reaching LiteLLM",
    async (method, template) => {
      const { callAllowlisted, LiteLLMRouteNotAllowed } = await load();
      await expect(
        callAllowlisted(
          {
            method: method as "GET",
            template,
            params: { team_id: T, user_id: "jane", key: "a".repeat(64) },
            actor: ACTOR,
          },
          opts,
        ),
      ).rejects.toBeInstanceOf(LiteLLMRouteNotAllowed);
      expect(fake.calls).toHaveLength(0);
    },
  );
});

describe("path parameters (guardrail 2)", () => {
  const TEMPLATE = "/team/{team_id}/member/{user_id}/reset_budget";
  const BAD = [
    ["a slash", "a/b"],
    ["a dot-dot", ".."],
    ["an embedded dot-dot", "a..b"],
    ["a question mark", "a?x=1"],
    ["a hash", "a#frag"],
    ["a percent sign", "a%2Fb"],
    ["an encoded slash", "%2F"],
    ["an empty value", ""],
    ["a line break", "a\nb"],
    ["a space", "a b"],
  ] as const;

  it.each(BAD)("{team_id} rejects %s, with no request", async (_n, value) => {
    const { callAllowlisted } = await load();
    await expect(
      callAllowlisted(
        {
          method: "POST",
          template: TEMPLATE,
          params: { team_id: value, user_id: "jane@company.com" },
          actor: ACTOR,
        },
        opts,
      ),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it.each(BAD)("{user_id} rejects %s, with no request", async (_n, value) => {
    const { callAllowlisted } = await load();
    await expect(
      callAllowlisted(
        {
          method: "POST",
          template: TEMPLATE,
          params: { team_id: T, user_id: value },
          actor: ACTOR,
        },
        opts,
      ),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it.each(BAD)("{key} rejects %s, with no request", async (_n, value) => {
    const { callAllowlisted } = await load({
      APP_ENV: "prod",
      LITELLM_ALLOWED_HOSTS: "litellm.test",
    });
    await expect(
      callAllowlisted(
        {
          method: "POST",
          template: "/key/{key}/regenerate",
          params: { key: value },
          body: {},
          actor: ACTOR,
        },
        { baseUrl: "https://litellm.test" },
      ),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects a missing parameter for a templated route, with no request", async () => {
    const { callAllowlisted } = await load();
    await expect(
      callAllowlisted(
        {
          method: "POST",
          template: TEMPLATE,
          params: { team_id: T },
          actor: ACTOR,
        },
        opts,
      ),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it("a parameter can never reach another route: the sent path has exactly the template's segments", async () => {
    const { callAllowlisted } = await load();
    await callAllowlisted(
      {
        method: "POST",
        template: TEMPLATE,
        params: { team_id: T, user_id: "jane.doe@company.com" },
        actor: ACTOR,
      },
      opts,
    );
    expect(fake.calls[0]!.path.split("/")).toHaveLength(
      TEMPLATE.split("/").length,
    );
    expect(fake.calls[0]!.path).toMatch(/\/reset_budget$/);
  });
});

describe("litellm-changed-by (LD14, LT19)", () => {
  const write = (actor?: { oid: string; email?: string | null }) => ({
    method: "POST" as const,
    template: "/team/new",
    body: { team_alias: "x" },
    ...(actor ? { actor } : {}),
  });

  it("sends llm-usage-lens:<lower-cased email> on a write", async () => {
    const { callAllowlisted } = await load();
    await callAllowlisted(write(ACTOR), opts);
    expect(fake.calls[0]!.headers["litellm-changed-by"]).toBe(
      "llm-usage-lens:jane.doe@company.com",
    );
  });

  it.each([
    ["null email", { oid: "oid-master-0001", email: null }],
    ["absent email", { oid: "oid-master-0001" }],
    ["empty email", { oid: "oid-master-0001", email: "" }],
  ])(
    "falls back to the oid for %s (master and local users)",
    async (_n, actor) => {
      const { callAllowlisted } = await load();
      await callAllowlisted(write(actor), opts);
      expect(fake.calls[0]!.headers["litellm-changed-by"]).toBe(
        "llm-usage-lens:oid-master-0001",
      );
    },
  );

  it("is sent on every write route, including those LiteLLM may ignore", async () => {
    const { callAllowlisted } = await load();
    await callAllowlisted(
      { method: "POST", template: "/team/member_add", body: {}, actor: ACTOR },
      opts,
    );
    expect(fake.calls[0]!.headers["litellm-changed-by"]).toBe(
      "llm-usage-lens:jane.doe@company.com",
    );
  });

  it("refuses a write with no actor, before any request", async () => {
    const { callAllowlisted } = await load();
    await expect(callAllowlisted(write(), opts)).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it.each([
    ["a CR/LF injection", "jane@company.com\r\nx-evil: 1"],
    ["a bare LF", "jane@company.com\nx"],
    ["a non-ASCII character", "jané@company.com"],
    ["a control character", "jane\u0007@company.com"],
    ["more than 256 characters", `${"a".repeat(250)}@company.com`],
  ])("refuses an actor with %s, with no request", async (_n, email) => {
    const { callAllowlisted } = await load();
    await expect(
      callAllowlisted(write({ oid: "oid-1", email }), opts),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it("is built from the actor only: a header or changedBy smuggled in the request is rejected", async () => {
    const { callAllowlisted } = await load();
    await expect(
      callAllowlisted(
        {
          ...write(ACTOR),
          headers: { "litellm-changed-by": "llm-usage-lens:attacker" },
        } as never,
        opts,
      ),
    ).rejects.toThrow();
    await expect(
      callAllowlisted(
        { ...write(ACTOR), changedBy: "llm-usage-lens:attacker" } as never,
        opts,
      ),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });
});

describe("edition gate at the choke point (LT15)", () => {
  it("refuses the Enterprise-only regenerate route on OSS with OPERATION_UNAVAILABLE and no request", async () => {
    const { callAllowlisted } = await load({ APP_ENV: "dev" });
    await expect(
      callAllowlisted(
        {
          method: "POST",
          template: "/key/{key}/regenerate",
          params: { key: "a".repeat(64) },
          body: {},
          actor: ACTOR,
        },
        opts,
      ),
    ).rejects.toMatchObject({ code: "OPERATION_UNAVAILABLE", status: 403 });
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses GET /global/spend/report on OSS with OPERATION_UNAVAILABLE and no request", async () => {
    const { callAllowlisted } = await load({ APP_ENV: "dev" });
    await expect(
      callAllowlisted(
        {
          method: "GET",
          template: "/global/spend/report",
          query: { group_by: "team" },
        },
        opts,
      ),
    ).rejects.toMatchObject({ code: "OPERATION_UNAVAILABLE", status: 403 });
    expect(fake.calls).toHaveLength(0);
  });

  it("allows the global spend report on Enterprise (APP_ENV=prod)", async () => {
    const { callAllowlisted } = await load({
      APP_ENV: "prod",
      LITELLM_ALLOWED_HOSTS: "litellm.test",
    });
    fake.setHandler(gatewayHandler({ edition: "enterprise" }));
    await callAllowlisted(
      {
        method: "GET",
        template: "/global/spend/report",
        query: { group_by: "team" },
      },
      { baseUrl: "https://litellm.test" },
    );
    expect(fake.calls).toHaveLength(1);
  });
});
