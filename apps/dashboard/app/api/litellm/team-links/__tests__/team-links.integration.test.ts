import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ApiErrorBodySchema } from "@llm-usage-lens/shared";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createAppTeam } from "@/lib/data/access/app-teams";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import {
  OTHER_TEAM_ID,
  TEAM_ID,
  gatewayHandler,
} from "@/test/fakes/fake-litellm-gateway";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
  testDoc,
} from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-litellm.md — "Data model additions"
// (TeamLink at LITELLM#TEAMLINK#{teamId}/META with GSI1 LITELLM#TEAMLINKS /
// TEAM#{teamId}; TeamLinkClaim at LITELLM#LTEAM#{litellmTeamId}/OWNER makes
// the LiteLLM team_id unique; every item versioned; a link and its claim are
// written in one TransactWriteItems with the audit item), "API routes"
// (/api/litellm/team-links and /[teamId]: GET Admin+Auditor, writes Admin;
// no-store), "Writes" (linkTeam/unlinkTeam are dashboard-only, Admin,
// audited, and read /team/info to confirm the team exists), "Roles and
// rights" (configuration is Admin only), Access Control D17, Rules 10.3,
// 20.6, 60.22, 60.23.
//
// Contract for the developer:
//   GET    /team-links            -> data.items = [{ teamId, litellmTeamId, version, updatedAt }] (ordered by teamId)
//   GET    /team-links/[teamId]   -> data = that item; 404 NOT_FOUND when unlinked
//   PUT    /team-links/[teamId]   body { litellmTeamId, version: number|null } -> 200 data = item
//          400 BAD_REQUEST when LiteLLM does not know the team (/team/info 4xx);
//          503 LITELLM_UNAVAILABLE when LiteLLM is unreachable; 409 CONFLICT for a stale
//          version or a litellmTeamId already claimed by another dashboard team.
//   DELETE /team-links/[teamId]   -> 200 data = { teamId }; 404 NOT_FOUND when unlinked;
//          removes link and claim.
//   Audit actions: litellm.teamlink.link, litellm.teamlink.unlink.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const HOST = "localhost:3000";
const LIST_URL = `http://${HOST}/api/litellm/team-links`;
const ONE_URL = (id: string) => `${LIST_URL}/${id}`;
const SAME_ORIGIN = { host: HOST, origin: `http://${HOST}` };
const session = (roles: string[]) => ({
  user: { oid: "oid-test", name: "T", email: "t@company.com", roles },
});
const ADMIN = session(["internal-admin"]);
const AUDITOR = session(["internal-auditor"]);
const VIEWER = session(["internal-viewer"]);
const LEAD = session(["internal-team-admin"]);
const ORG_ADMIN = {
  user: {
    oid: "oid-org",
    name: "O",
    email: "o@company.com",
    roles: ["internal-org-admin"],
  },
};

let fake: ReturnType<typeof createFakeLiteLLM>;
function install(opts: Parameters<typeof gatewayHandler>[0] = {}) {
  fake = createFakeLiteLLM((call, n) => {
    // An unknown LiteLLM team: /team/info answers 404 for ids other than the two fixtures.
    if (call.method === "GET" && call.path === "/team/info") {
      const id = new URL(call.url).searchParams.get("team_id");
      if (id !== TEAM_ID && id !== OTHER_TEAM_ID) {
        return { status: 404, body: { detail: "SENTINEL-UPSTREAM-BODY" } };
      }
    }
    return gatewayHandler(opts)(call, n);
  });
  vi.stubGlobal("fetch", fake.fetch);
}

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
  const list = await import("../route");
  const one = await import("../[teamId]/route");
  return { LIST: list.GET, GET: one.GET, PUT: one.PUT, DELETE: one.DELETE };
}

async function storeConnection() {
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
}

const ctxFor = (teamId?: string) => ({
  params: Promise.resolve(teamId === undefined ? {} : { teamId }),
});
const get = (url: string) => new Request(url, { headers: { host: HOST } });
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

const item = async (pk: string, sk: string) =>
  (
    await testDoc().send(
      new GetCommand({ TableName: TEST_TABLE_NAME, Key: { PK: pk, SK: sk } }),
    )
  ).Item;
const linkItem = (teamId: string) => item(`LITELLM#TEAMLINK#${teamId}`, "META");
const claimItem = (litellmTeamId: string) =>
  item(`LITELLM#LTEAM#${litellmTeamId}`, "OWNER");

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
  expect(JSON.stringify(raw)).not.toContain("SENTINEL-UPSTREAM-BODY");
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));
  authMock.mockResolvedValue(ADMIN);
  install();
  await clearTable();
  await storeConnection();
  // A link needs an existing dashboard team (a team on an AccountMeta).
  await loadFixtures({
    accounts: [
      makeAccount(1, { teamId: "team-a", teamName: "Team A" }),
      makeAccount(2, { teamId: "team-b", teamName: "Team B" }),
    ],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function storeToggles(toggles: Record<string, boolean>) {
  await testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: {
        PK: "LITELLM#CONFIG",
        SK: "TOGGLES",
        version: 1,
        toggles,
        updatedAt: "2026-11-14T10:00:00.000Z",
      },
    }),
  );
}

const link = (
  h: Awaited<ReturnType<typeof load>>,
  teamId: string,
  litellmTeamId: string,
  version: number | null = null,
) =>
  h.PUT(
    send("PUT", ONE_URL(teamId), { litellmTeamId, version }),
    ctxFor(teamId),
  );

describe("authorisation (every method)", () => {
  it.each([
    ["a viewer", VIEWER],
    ["a team lead", LEAD],
    ["no roles", { user: { oid: "oid-test" } }],
  ])("returns 403 on reads and writes for %s", async (_n, s) => {
    authMock.mockResolvedValue(s);
    const h = await load();
    await expectError(await h.LIST(get(LIST_URL), ctxFor()), 403, "FORBIDDEN");
    await expectError(
      await h.GET(get(ONE_URL("team-a")), ctxFor("team-a")),
      403,
      "FORBIDDEN",
    );
    await expectError(await link(h, "team-a", TEAM_ID), 403, "FORBIDDEN");
    expect(await linkItem("team-a")).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });

  it("a stored internal-admin grant opens reads for a session whose claim lacks the role (Rule 50.4, route-guard)", async () => {
    const { grantRole } = await import("@/lib/data/access/role-grants");
    const { ctxAt, ok } = await import("@/test/support/access-test-support");
    authMock.mockResolvedValue({ user: { oid: "oid-granted" } });
    ok(
      await grantRole(
        { oid: "oid-granted", role: "internal-admin", reason: "test" },
        ctxAt(),
      ),
    );
    const h = await load();
    expect((await h.LIST(get(LIST_URL), ctxFor())).status).toBe(200);
  });

  it("an Auditor may read but every write is 403 FORBIDDEN with one denied audit record each (D17), and nothing stored", async () => {
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    authMock.mockResolvedValue(AUDITOR);
    expect((await h.LIST(get(LIST_URL), ctxFor())).status).toBe(200);
    expect((await h.GET(get(ONE_URL("team-a")), ctxFor("team-a"))).status).toBe(
      200,
    );

    const before = (await auditActions()).length;
    await expectError(await link(h, "team-b", OTHER_TEAM_ID), 403, "FORBIDDEN");
    await expectError(
      await h.DELETE(send("DELETE", ONE_URL("team-a")), ctxFor("team-a")),
      403,
      "FORBIDDEN",
    );
    // Audit listing order is by timestamp then random request id, and the
    // clock is frozen, so select the new records by content, not position.
    const all = await auditActions();
    expect(all).toHaveLength(before + 2);
    const records = all.filter((r) => r.result === "denied");
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.action).sort()).toEqual([
      "litellm.teamlink.link",
      "litellm.teamlink.unlink",
    ]);
    for (const r of records) {
      expect(r).toMatchObject({
        result: "denied",
        code: "FORBIDDEN",
        actor: "oid-test",
      });
      expect(JSON.stringify(r.route)).not.toContain("team-a");
    }
    expect(await linkItem("team-b")).toBeUndefined();
    expect(await linkItem("team-a")).toBeDefined();
  });

  it("every route is 403 OPERATION_UNAVAILABLE in open access mode", async () => {
    const h = await load({ AUTH_ACCESS_MODE: "open" });
    await expectError(
      await h.LIST(get(LIST_URL), ctxFor()),
      403,
      "OPERATION_UNAVAILABLE",
    );
    await expectError(
      await link(h, "team-a", TEAM_ID),
      403,
      "OPERATION_UNAVAILABLE",
    );
    expect(await linkItem("team-a")).toBeUndefined();
  });
});

describe("PUT /api/litellm/team-links/[teamId] (linkTeam)", () => {
  it("confirms the team through /team/info, then writes link + claim (versioned) and one audit record", async () => {
    const h = await load();
    const res = await link(h, "team-a", TEAM_ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await res.clone().json()).data).toMatchObject({
      teamId: "team-a",
      litellmTeamId: TEAM_ID,
      version: 1,
    });

    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /team/info",
    ]);
    expect(new URL(fake.calls[0]!.url).searchParams.get("team_id")).toBe(
      TEAM_ID,
    );

    const l = await linkItem("team-a");
    expect(l).toMatchObject({
      litellmTeamId: TEAM_ID,
      version: 1,
      gsi1pk: "LITELLM#TEAMLINKS",
      gsi1sk: "TEAM#team-a",
    });
    const c = await claimItem(TEAM_ID);
    expect(c).toMatchObject({ teamId: "team-a", version: 1 });

    const records = await auditActions();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "litellm.teamlink.link",
      actor: "oid-test",
      result: "success",
    });
    expect(JSON.stringify(records[0])).toContain(TEAM_ID);
  });

  it("sends no LiteLLM write (linkTeam is dashboard-only)", async () => {
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    expect(fake.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("returns 400 when LiteLLM does not know the team: nothing stored, nothing audited, upstream body not echoed", async () => {
    const h = await load();
    await expectError(
      await link(h, "team-a", "99999999-9999-4999-8999-999999999999"),
      400,
      "BAD_REQUEST",
    );
    expect(await linkItem("team-a")).toBeUndefined();
    expect(
      await claimItem("99999999-9999-4999-8999-999999999999"),
    ).toBeUndefined();
    expect(await auditActions()).toHaveLength(0);
  });

  it("returns 503 LITELLM_UNAVAILABLE when LiteLLM is unreachable, storing nothing", async () => {
    fake.setHandler(() => ({
      status: 401,
      body: { detail: "SENTINEL-UPSTREAM-BODY" },
    }));
    const h = await load();
    await expectError(
      await link(h, "team-a", TEAM_ID),
      503,
      "LITELLM_UNAVAILABLE",
    );
    expect(await linkItem("team-a")).toBeUndefined();
    expect(await auditActions()).toHaveLength(0);
  });

  it("returns 409 CONFLICT when another dashboard team already claims the LiteLLM team, writing nothing", async () => {
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    await expectError(await link(h, "team-b", TEAM_ID), 409, "CONFLICT");
    expect(await linkItem("team-b")).toBeUndefined();
    expect((await claimItem(TEAM_ID))?.teamId).toBe("team-a");
    expect(await auditActions()).toHaveLength(1);
  });

  it("re-linking to another LiteLLM team moves the claim in one step and bumps the version", async () => {
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    const res = await link(h, "team-a", OTHER_TEAM_ID, 1);
    expect(res.status).toBe(200);
    expect((await res.clone().json()).data.version).toBe(2);
    expect((await linkItem("team-a"))?.litellmTeamId).toBe(OTHER_TEAM_ID);
    expect(await claimItem(TEAM_ID)).toBeUndefined();
    expect((await claimItem(OTHER_TEAM_ID))?.teamId).toBe("team-a");
    // the freed LiteLLM team can now be linked by another dashboard team
    expect((await link(h, "team-b", TEAM_ID)).status).toBe(200);
  });

  it("returns 404 NOT_FOUND for a dashboard team that does not exist: nothing stored, nothing audited", async () => {
    const h = await load();
    await expectError(await link(h, "team-ghost", TEAM_ID), 404, "NOT_FOUND");
    expect(await linkItem("team-ghost")).toBeUndefined();
    expect(await claimItem(TEAM_ID)).toBeUndefined();
    expect(await auditActions()).toHaveLength(0);
  });

  it("linking works with the getTeam read toggle off (the link probe bypasses the read toggle)", async () => {
    await storeToggles({ getTeam: false });
    const h = await load();
    const res = await link(h, "team-a", TEAM_ID);
    expect(res.status).toBe(200);
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /team/info",
    ]);
    expect((await linkItem("team-a"))?.litellmTeamId).toBe(TEAM_ID);
  });

  it("a relink deletes the old claim only while it still belongs to this team: a claim taken over by another team survives and the relink is 409", async () => {
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    // The old claim now belongs to team-b (a race or a repaired record).
    await testDoc().send(
      new PutCommand({
        TableName: TEST_TABLE_NAME,
        Item: {
          PK: `LITELLM#LTEAM#${TEAM_ID}`,
          SK: "OWNER",
          teamId: "team-b",
          version: 1,
          updatedAt: "2026-11-14T10:00:00.000Z",
        },
      }),
    );
    await expectError(
      await link(h, "team-a", OTHER_TEAM_ID, 1),
      409,
      "CONFLICT",
    );
    expect((await claimItem(TEAM_ID))?.teamId).toBe("team-b");
    expect((await linkItem("team-a"))?.litellmTeamId).toBe(TEAM_ID);
    expect(await claimItem(OTHER_TEAM_ID)).toBeUndefined();
  });

  it("returns 409 for a stale or missing version on an existing link, changing nothing", async () => {
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    await expectError(
      await link(h, "team-a", OTHER_TEAM_ID, null),
      409,
      "CONFLICT",
    );
    await expectError(
      await link(h, "team-a", OTHER_TEAM_ID, 9),
      409,
      "CONFLICT",
    );
    expect((await linkItem("team-a"))?.litellmTeamId).toBe(TEAM_ID);
    expect(await claimItem(OTHER_TEAM_ID)).toBeUndefined();
  });

  it.each([
    ["a missing litellmTeamId", { version: null }],
    ["an empty litellmTeamId", { litellmTeamId: "", version: null }],
    ["a litellmTeamId with a slash", { litellmTeamId: "a/b", version: null }],
    ["a litellmTeamId with dot-dot", { litellmTeamId: "..", version: null }],
    ["a litellmTeamId with a query", { litellmTeamId: "a?b=1", version: null }],
    [
      "a litellmTeamId with a percent sign",
      { litellmTeamId: "a%2Fb", version: null },
    ],
    [
      "an extra field",
      { litellmTeamId: TEAM_ID, version: null, route: "/team/delete" },
    ],
    ["a non-integer version", { litellmTeamId: TEAM_ID, version: "1" }],
  ])(
    "returns 400 for %s: no LiteLLM call, nothing stored or audited",
    async (_n, body) => {
      const h = await load();
      const res = await h.PUT(
        send("PUT", ONE_URL("team-a"), body),
        ctxFor("team-a"),
      );
      await expectError(res, 400, "BAD_REQUEST");
      expect(fake.calls).toHaveLength(0);
      expect(await linkItem("team-a")).toBeUndefined();
      expect(await auditActions()).toHaveLength(0);
    },
  );
});

describe("GET /api/litellm/team-links and /[teamId]", () => {
  it("lists links ordered by teamId, from GSI1, reading LiteLLM only for the picker list (GET /team/list)", async () => {
    const h = await load();
    await link(h, "team-b", OTHER_TEAM_ID);
    await link(h, "team-a", TEAM_ID);
    fake.calls.length = 0;
    const res = await h.LIST(get(LIST_URL), ctxFor());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const items = (await res.json()).data.items as Array<
      Record<string, unknown>
    >;
    expect(items.map((i) => i.teamId)).toEqual(["team-a", "team-b"]);
    expect(items[0]).toMatchObject({ litellmTeamId: TEAM_ID, version: 1 });
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /team/list",
    ]);
  });

  // App Teams spec - UI ("Settings -> LiteLLM -> Team links: a 'Spend source'
  // column for every app team"). No new route: the list answer gains
  // `appTeams: [{ teamId, teamName, spendSource }]` for EVERY app team, ordered
  // by team name; "litellm-team" when linked, else "member-sum". `items` is
  // unchanged. Test-engineer reading of an unspecified data source (see report).
  it("also lists every app team with its spend source: litellm-team when linked, member-sum when not (App Teams - UI)", async () => {
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    fake.calls.length = 0;
    const res = await h.LIST(get(LIST_URL), ctxFor());
    const data = (await res.json()).data as {
      items: Array<{ teamId: string }>;
      appTeams: Array<Record<string, unknown>>;
    };
    expect(data.items.map((i) => i.teamId)).toEqual(["team-a"]);
    expect(data.appTeams).toEqual([
      { teamId: "team-a", teamName: "Team A", spendSource: "litellm-team" },
      { teamId: "team-b", teamName: "Team B", spendSource: "member-sum" },
    ]);
  });

  it("an empty list is an empty array, not an error", async () => {
    const h = await load();
    const res = await h.LIST(get(LIST_URL), ctxFor());
    expect(res.status).toBe(200);
    expect((await res.json()).data.items).toEqual([]);
  });

  it("returns one link, or 404 NOT_FOUND when the team is not linked", async () => {
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    const ok = await h.GET(get(ONE_URL("team-a")), ctxFor("team-a"));
    expect((await ok.json()).data).toMatchObject({
      teamId: "team-a",
      litellmTeamId: TEAM_ID,
    });
    await expectError(
      await h.GET(get(ONE_URL("team-z")), ctxFor("team-z")),
      404,
      "NOT_FOUND",
    );
  });
});

describe("DELETE /api/litellm/team-links/[teamId] (unlinkTeam)", () => {
  it("removes the link and its claim and writes one audit record, with no LiteLLM call", async () => {
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    fake.calls.length = 0;
    const res = await h.DELETE(
      send("DELETE", ONE_URL("team-a")),
      ctxFor("team-a"),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ teamId: "team-a" });
    expect(await linkItem("team-a")).toBeUndefined();
    expect(await claimItem(TEAM_ID)).toBeUndefined();
    const actions = (await auditActions()).map((r) => r.action).sort();
    expect(actions).toEqual([
      "litellm.teamlink.link",
      "litellm.teamlink.unlink",
    ]);
    expect(fake.calls).toHaveLength(0);
  });

  it("returns 404 NOT_FOUND for an unlinked team and writes no audit record", async () => {
    const h = await load();
    await expectError(
      await h.DELETE(send("DELETE", ONE_URL("team-z")), ctxFor("team-z")),
      404,
      "NOT_FOUND",
    );
    expect(await auditActions()).toHaveLength(0);
  });
});

// LD24 / LT22 (spec 2026-11-10-litellm.md): internal-org-admin reads and writes
// team links; each write is audited with the org-admin as actor. A role held
// only through a stored RoleGrant counts (Rule 50.4).
describe("internal-org-admin on /api/litellm/team-links (LD24, LT22)", () => {
  it("reads answer 200 (list and one)", async () => {
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    authMock.mockResolvedValue(ORG_ADMIN);
    expect((await h.LIST(get(LIST_URL), ctxFor())).status).toBe(200);
    expect((await h.GET(get(ONE_URL("team-a")), ctxFor("team-a"))).status).toBe(
      200,
    );
  });

  it("PUT links a team and DELETE unlinks it, each audited with the org-admin as actor", async () => {
    authMock.mockResolvedValue(ORG_ADMIN);
    const h = await load();
    expect((await link(h, "team-a", TEAM_ID)).status).toBe(200);
    expect(await linkItem("team-a")).toBeDefined();
    const res = await h.DELETE(
      send("DELETE", ONE_URL("team-a")),
      ctxFor("team-a"),
    );
    expect(res.status).toBe(200);
    expect(await linkItem("team-a")).toBeUndefined();
    const records = await auditActions();
    expect(records.map((r) => r.action).sort()).toEqual([
      "litellm.teamlink.link",
      "litellm.teamlink.unlink",
    ]);
    for (const r of records) {
      expect(r).toMatchObject({ actor: "oid-org", result: "success" });
    }
  });

  it("an internal-org-admin held only as a stored RoleGrant (no claim) reads and writes (Rule 50.4)", async () => {
    const { grantRole } = await import("@/lib/data/access/role-grants");
    const { ctxAt, ok } = await import("@/test/support/access-test-support");
    authMock.mockResolvedValue({ user: { oid: "oid-granted" } });
    ok(
      await grantRole(
        { oid: "oid-granted", role: "internal-org-admin", reason: "test" },
        ctxAt(),
      ),
    );
    const h = await load();
    expect((await h.LIST(get(LIST_URL), ctxFor())).status).toBe(200);
    expect((await link(h, "team-a", TEAM_ID)).status).toBe(200);
    expect((await auditActions())[0]).toMatchObject({ actor: "oid-granted" });
  });

  it("a team lead and a viewer still get 403 on both writes with one denied record each (LT22)", async () => {
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    for (const s of [LEAD, VIEWER]) {
      authMock.mockResolvedValue(s);
      await expectError(
        await link(h, "team-b", OTHER_TEAM_ID),
        403,
        "FORBIDDEN",
      );
      await expectError(
        await h.DELETE(send("DELETE", ONE_URL("team-a")), ctxFor("team-a")),
        403,
        "FORBIDDEN",
      );
    }
    const denied = (await auditActions()).filter((r) => r.result === "denied");
    expect(denied).toHaveLength(2);
    expect(await linkItem("team-a")).toBeDefined();
    expect(await linkItem("team-b")).toBeUndefined();
  });
});

// Source: docs/specs/2026-11-17-app-teams.md - "Teams without an AWS account"
// (a created team takes a link like any team); Access Control - "Created app
// teams" and T-MI3 (an unknown team id is refused; one LiteLLM team has one
// owner); LiteLLM spec LT-MI3 / "Identity mapping" (one-to-one). The "known
// team" check of PUT reads the team directory (M2 design 1, group M2-b); the
// 404 and 409 outcomes are unchanged.
describe("PUT /api/litellm/team-links/[teamId] for a created team (App Teams; T-MI3)", () => {
  const unknownId = "appteam-00000000-0000-4000-8000-00000000dead";
  const createTeam = async (name = "Guild") =>
    ok(
      await createAppTeam(
        { name, departmentId: "dept-eng", departmentName: "Engineering" },
        ctxAt(undefined, `req-create-${name}`),
      ),
    ).teamId;

  it.each([
    ["internal-admin", ADMIN],
    ["internal-org-admin", ORG_ADMIN],
  ] as const)(
    "%s links a created team: link, claim and one audit record are written",
    async (_role, who) => {
      authMock.mockResolvedValue(who);
      const teamId = await createTeam();
      const h = await load();
      const res = await link(h, teamId, TEAM_ID);
      expect(res.status).toBe(200);
      expect((await res.clone().json()).data).toMatchObject({
        teamId,
        litellmTeamId: TEAM_ID,
        version: 1,
      });
      expect(await linkItem(teamId)).toMatchObject({ litellmTeamId: TEAM_ID });
      expect((await claimItem(TEAM_ID))?.teamId).toBe(teamId);
      expect(await auditActions()).toHaveLength(1);
    },
  );

  it("an unknown appteam- id is still 404 NOT_FOUND: nothing stored, nothing audited (T-MI3)", async () => {
    await createTeam();
    const h = await load();
    await expectError(await link(h, unknownId, TEAM_ID), 404, "NOT_FOUND");
    expect(await linkItem(unknownId)).toBeUndefined();
    expect(await claimItem(TEAM_ID)).toBeUndefined();
    expect(await auditActions()).toHaveLength(0);
  });

  it("a LiteLLM team already linked to another team is still 409 CONFLICT for a created team: link and claim unchanged (T-MI3 / LT-MI3)", async () => {
    const teamId = await createTeam();
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    await expectError(await link(h, teamId, TEAM_ID), 409, "CONFLICT");
    expect(await linkItem(teamId)).toBeUndefined();
    expect((await claimItem(TEAM_ID))?.teamId).toBe("team-a");
    expect(await auditActions()).toHaveLength(1);
  });
});

// M2 merge wiring (App Teams spec - Teams without an AWS account; MI-D4a;
// implementation-phases M2 "Merge wiring"): GET lists a created team in
// `appTeams` beside the registry teams, for the audience that may read the
// view (Admin, Org admin, Auditor) and no one else (LiteLLM spec - API routes).
describe("GET /api/litellm/team-links - appTeams holds created teams (MI-D4a, T-MI3)", () => {
  const create = async () =>
    ok(
      await createAppTeam(
        {
          name: "Platform Guild",
          departmentId: "dept-eng",
          departmentName: "Engineering",
        },
        ctxAt(undefined, "req-create-guild"),
      ),
    ).teamId;

  it.each([
    ["internal-admin", ADMIN],
    ["internal-org-admin", ORG_ADMIN],
    ["internal-auditor", AUDITOR],
  ])(
    "%s sees the created team in appTeams (unlinked: member-sum; linked: litellm-team) beside the registry teams",
    async (_role, s) => {
      const teamId = await create();
      const h = await load();
      authMock.mockResolvedValue(s);
      let data = (await (await h.LIST(get(LIST_URL), ctxFor())).json()).data;
      expect(data.appTeams).toContainEqual({
        teamId,
        teamName: "Platform Guild",
        spendSource: "member-sum",
      });
      expect(data.appTeams.map((t: { teamId: string }) => t.teamId)).toEqual(
        expect.arrayContaining(["team-a", "team-b", teamId]),
      );

      authMock.mockResolvedValue(ADMIN);
      expect((await link(h, teamId, TEAM_ID)).status).toBe(200);
      authMock.mockResolvedValue(s);
      data = (await (await h.LIST(get(LIST_URL), ctxFor())).json()).data;
      expect(data.appTeams).toContainEqual({
        teamId,
        teamName: "Platform Guild",
        spendSource: "litellm-team",
      });
    },
  );

  it.each([
    ["internal-team-admin (lead)", LEAD],
    ["internal-viewer", VIEWER],
  ])(
    "%s is refused 403 and learns no created team (LiteLLM spec - API routes)",
    async (_role, s) => {
      await create();
      const h = await load();
      authMock.mockResolvedValue(s);
      const res = await h.LIST(get(LIST_URL), ctxFor());
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).not.toContain("Platform Guild");
    },
  );
});

// M1 (MI-D4a, LD37, LT-MI3; Design System D4a): `GET /api/litellm/team-links`
// gains the optional `litellmTeams` ({ litellmTeamId, alias }[], from
// listProxyTeams) for the pickers. Same audience as before (no wider read);
// the listProxyTeams toggle is respected; not configured is `configured: false`
// with no list and never 503; an outage of that read keeps the links list and
// marks the list unavailable. Writes and their refusals (unknown id 400/404,
// duplicate 409, auditor and lead 403) are asserted above and unchanged.
describe("GET /api/litellm/team-links - litellmTeams for the pickers (MI-D4a)", () => {
  const callsOf = () => fake.calls.map((c) => `${c.method} ${c.path}`);

  it.each([
    ["internal-admin", ADMIN],
    ["internal-org-admin", ORG_ADMIN],
    ["internal-auditor", AUDITOR],
  ])(
    "%s gets 200 with every LiteLLM team, linked or not, beside the links",
    async (_role, s) => {
      const h = await load();
      await link(h, "team-a", TEAM_ID);
      authMock.mockResolvedValue(s);
      const res = await h.LIST(get(LIST_URL), ctxFor());
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const data = (await res.json()).data;
      expect(data.litellmTeams).toEqual([
        { litellmTeamId: TEAM_ID, alias: "Alpha" },
      ]);
      expect(data.litellmTeamsUnavailable).toBeUndefined();
      expect(data.items.map((i: { teamId: string }) => i.teamId)).toEqual([
        "team-a",
      ]);
    },
  );

  it.each([
    ["a viewer", VIEWER],
    ["a team lead", LEAD],
  ])(
    "%s gets 403 with no litellmTeams and no LiteLLM call (audience unchanged)",
    async (_n, s) => {
      authMock.mockResolvedValue(s);
      const h = await load();
      const res = await h.LIST(get(LIST_URL), ctxFor());
      await expectError(res, 403, "FORBIDDEN");
      expect(JSON.stringify(await res.json())).not.toContain("litellmTeams");
      expect(fake.calls).toHaveLength(0);
    },
  );

  it("the listProxyTeams toggle off keeps the links, marks the list unavailable and makes no LiteLLM call", async () => {
    await storeToggles({ listProxyTeams: false });
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    fake.calls.length = 0;
    const res = await h.LIST(get(LIST_URL), ctxFor());
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.litellmTeamsUnavailable).toBe(true);
    expect(data.litellmTeams).toBeUndefined();
    expect(data.items).toHaveLength(1);
    expect(callsOf()).toEqual([]);
  });

  it("LiteLLM not configured (LD37) is 200 with configured:false, no litellmTeams and no LiteLLM call, never 503", async () => {
    await testDoc().send(
      new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#CONFIG", SK: "CONNECTION" },
      }),
    );
    const h = await load();
    const res = await h.LIST(get(LIST_URL), ctxFor());
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.configured).toBe(false);
    expect(data.litellmTeams).toBeUndefined();
    expect(data.items).toEqual([]);
    expect(data.appTeams).toHaveLength(2);
    expect(fake.calls).toHaveLength(0);
  });

  it("an outage of the team list keeps the links and appTeams and marks the list unavailable, never 503, upstream body not echoed", async () => {
    const h = await load();
    await link(h, "team-a", TEAM_ID);
    fake.setHandler((call, n) =>
      call.path === "/team/list"
        ? { status: 500, body: { detail: "SENTINEL-UPSTREAM-BODY" } }
        : gatewayHandler()(call, n),
    );
    const res = await h.LIST(get(LIST_URL), ctxFor());
    expect(res.status).toBe(200);
    const raw = await res.json();
    expect(JSON.stringify(raw)).not.toContain("SENTINEL-UPSTREAM-BODY");
    expect(raw.data.litellmTeamsUnavailable).toBe(true);
    expect(raw.data.litellmTeams).toBeUndefined();
    expect(raw.data.items).toHaveLength(1);
    expect(raw.data.appTeams).toHaveLength(2);
  });

  it("open access mode stays 403 OPERATION_UNAVAILABLE with no litellmTeams and no LiteLLM call", async () => {
    const h = await load({ AUTH_ACCESS_MODE: "open" });
    const res = await h.LIST(get(LIST_URL), ctxFor());
    await expectError(res, 403, "OPERATION_UNAVAILABLE");
    expect(JSON.stringify(await res.json())).not.toContain("litellmTeams");
    expect(fake.calls).toHaveLength(0);
  });
});
