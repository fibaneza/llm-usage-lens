import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.fakeNextCache;
});
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: () => auth() }));
// Authorization data is read per request, stored role grants included, and never
// cached (Access Control spec - Enforcement item 1; Rule 60.10). This file
// tests the data-read cache, so the per-request authorization reads see an
// empty table; they are not counted as data reads.
vi.mock("@/lib/dynamodb", () => ({
  getTableName: () => "test-table",
  getDocumentClient: () => ({
    send: vi.fn(async () => ({ Items: [] })),
  }),
}));
const data = vi.hoisted(() => ({
  getRollupsByDate: vi.fn(),
  getAllAccounts: vi.fn(),
  getAccountsByDepartment: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deactivateAccount: vi.fn(),
  getSyncStatus: vi.fn(),
  hasAppTeamName: vi.fn(),
  listAppTeams: vi.fn(),
}));
vi.mock("@/lib/data/daily-rollups", () => ({
  getRollupsByDate: data.getRollupsByDate,
}));
vi.mock("@/lib/data/account-meta", () => ({
  getAllAccounts: data.getAllAccounts,
  getAccountsByDepartment: data.getAccountsByDepartment,
  createAccount: data.createAccount,
  updateAccount: data.updateAccount,
  deactivateAccount: data.deactivateAccount,
}));
// The account writes read the created-team name claim (Access Control - Created
// app teams, T-MI3); this file pins caching, not that check.
vi.mock("@/lib/data/access/app-teams", () => ({
  hasAppTeamName: data.hasAppTeamName,
  listAppTeams: data.listAppTeams,
}));
vi.mock("@/lib/data/sync-status", () => ({
  getSyncStatus: data.getSyncStatus,
}));
vi.mock("@/lib/data/access/identity-links", () => ({
  getIdentityLink: vi.fn().mockResolvedValue(null),
}));

import { DELETE, PATCH } from "@/app/api/accounts/[id]/route";
import { GET as getAccounts, POST } from "@/app/api/accounts/route";
import { GET as getOverview } from "@/app/api/overview/route";
import { GET as getSyncStatus } from "@/app/api/sync-status/route";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import {
  MAX_CACHE_ENTRY_BYTES,
  cacheEntrySizes,
  cacheRegistrations,
  oversizedEntries,
  resetFakeCache,
  revalidatedTags,
  revalidations,
} from "@/test/fakes/next-cache-fake";
import { buildRollup } from "@/test/fixtures/rollup-builder";

const acct = (n: number) => String(n).padStart(12, "0");

// Source: Rule 60.10 (cached reads, 1 h revalidate matching the hourly
// collector); Design System spec — "Caching Strategy"; Rule 50.4 (401 before
// any data access). Sync status uses a shorter window because SyncCountdown
// reads nextScheduledAt and unstable_cache serves stale-then-refresh.
// next/cache is replaced by an in-memory memoizing fake with tag invalidation.
const ONE_HOUR = 3600;
const SYNC_STATUS_REVALIDATE = 300;
const ACCOUNT = {
  accountId: acct(1),
  accountName: "account-1",
  departmentId: "dept-engineering",
  departmentName: "Engineering",
  teamId: "team-payments",
  teamName: "Payments",
  region: "ap-southeast-2",
  active: true,
  createdAt: "2026-05-15T08:00:00.000Z",
  updatedAt: "2026-05-15T08:00:00.000Z",
};
// D-ST5: names only; the server generates the ids.
const CREATE_BODY = {
  accountId: acct(42),
  accountName: "new-account",
  departmentName: "Finance",
  teamName: "Ledger",
  region: "ap-southeast-2",
};
const SESSION = {
  user: {
    oid: "oid-test",
    name: "t",
    email: "t@company.com",
    roles: ["internal-admin"],
  },
};
// Account writes need the Admin role (System Architecture — Authentication &
// Access, Account-mutation role; Data Model — HTTP status codes: 403 for a
// signed-in non-admin). Reads and the cache tests keep the role-less SESSION.
const ADMIN_SESSION = {
  user: { ...SESSION.user, roles: ["internal-admin"] },
};
const NON_ADMIN_SESSION = {
  user: { ...SESSION.user, roles: ["internal-viewer"] },
};
const ctx = (id = acct(1)) => ({ params: Promise.resolve({ id }) });
const get = (url: string) => new Request(`http://localhost${url}`);
// Same-origin write (Access Control spec — Enforcement item 6): Origin's host
// equals the Host header, which a Node `Request` does not carry by default.
const write = (method: string, body: unknown) =>
  new Request("http://localhost/api/accounts", {
    method,
    headers: {
      "content-type": "application/json",
      host: "localhost",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
const OVERVIEW = "/api/overview?dateFrom=2026-10-01&dateTo=2026-10-02";
const callOverview = (url = OVERVIEW) =>
  (getOverview as (r: Request, c: unknown) => Promise<Response>)(
    get(url),
    ctx(),
  );
const callGet = (h: unknown, url: string) =>
  (h as (r: Request, c: unknown) => Promise<Response>)(get(url), ctx());

beforeEach(() => {
  resetFakeCache();
  auth.mockReset();
  auth.mockResolvedValue(SESSION);
  for (const fn of Object.values(data)) fn.mockReset();
  data.getRollupsByDate.mockImplementation(async (date: string) => [
    buildRollup({ date, accountId: ACCOUNT.accountId }),
  ]);
  data.getAllAccounts.mockResolvedValue([ACCOUNT]);
  data.getSyncStatus.mockResolvedValue({ state: "never-synced" });
  data.hasAppTeamName.mockResolvedValue(false);
  data.listAppTeams.mockResolvedValue([]);
  data.createAccount.mockResolvedValue(ACCOUNT);
  data.updateAccount.mockResolvedValue(ACCOUNT);
  data.deactivateAccount.mockResolvedValue({ ...ACCOUNT, active: false });
});

describe("cache registration", () => {
  async function warmAll() {
    await callOverview();
    await callGet(getAccounts, "/api/accounts");
    await callGet(getSyncStatus, "/api/sync-status");
  }
  const registeredFor = (tag: string) =>
    cacheRegistrations.filter((r) => r.options.tags?.includes(tag));

  it("rollups and accounts reads are cached for 1 h with tags", async () => {
    await warmAll();
    for (const tag of ["rollups", "accounts"]) {
      expect(registeredFor(tag).length).toBeGreaterThan(0);
      for (const r of registeredFor(tag)) {
        expect(r.options.revalidate).toBe(ONE_HOUR);
      }
    }
  });

  it("sync-status is tagged and revalidates every 5 minutes, not hourly", async () => {
    await warmAll();
    expect(registeredFor("sync-status").length).toBeGreaterThan(0);
    for (const r of registeredFor("sync-status")) {
      expect(r.options.revalidate).toBe(SYNC_STATUS_REVALIDATE);
    }
  });
});

describe("cached reads", () => {
  it("a second identical overview request does not re-read DynamoDB", async () => {
    expect((await callOverview()).status).toBe(200);
    expect(data.getRollupsByDate).toHaveBeenCalledTimes(2);
    expect((await callOverview()).status).toBe(200);
    expect(data.getRollupsByDate).toHaveBeenCalledTimes(2);
  });

  it("a different range is a different cache entry", async () => {
    await callOverview();
    await callOverview("/api/overview?dateFrom=2026-10-03&dateTo=2026-10-03");
    expect(data.getRollupsByDate).toHaveBeenCalledTimes(3);
  });

  it("GET /api/accounts reads accounts once across requests", async () => {
    await callGet(getAccounts, "/api/accounts");
    await callGet(getAccounts, "/api/accounts");
    expect(data.getAllAccounts).toHaveBeenCalledTimes(1);
  });

  it("GET /api/sync-status reads the status once across requests", async () => {
    await callGet(getSyncStatus, "/api/sync-status");
    await callGet(getSyncStatus, "/api/sync-status");
    expect(data.getSyncStatus).toHaveBeenCalledTimes(1);
  });
});

describe("auth stays outside the cache", () => {
  it.each([
    ["overview", getOverview, OVERVIEW],
    ["accounts", getAccounts, "/api/accounts"],
    ["sync-status", getSyncStatus, "/api/sync-status"],
  ])("%s: warm cache + no session still returns 401", async (_n, h, url) => {
    await callGet(h, url);
    auth.mockResolvedValue(null);
    const res = await callGet(h, url);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("an unauthenticated request touches no data function", async () => {
    auth.mockResolvedValue(null);
    await callOverview();
    await callGet(getAccounts, "/api/accounts");
    await callGet(getSyncStatus, "/api/sync-status");
    for (const fn of Object.values(data)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("account writes invalidate the accounts tag", () => {
  beforeEach(() => {
    auth.mockResolvedValue(ADMIN_SESSION);
  });

  // Create reads the account list uncached to generate ids (Data Model -
  // API Routes, POST /api/accounts), so a POST adds one direct read.
  async function warmThenWrite(run: () => Promise<Response>, ownReads = 0) {
    await callGet(getAccounts, "/api/accounts");
    expect(data.getAllAccounts).toHaveBeenCalledTimes(1);
    const res = await run();
    expect(res.status).toBe(200);
    expect(revalidatedTags).toContain("accounts");
    expect(revalidations).toContainEqual({
      tag: "accounts",
      profile: { expire: 0 },
    });
    await callGet(getAccounts, "/api/accounts");
    expect(data.getAllAccounts).toHaveBeenCalledTimes(2 + ownReads);
  }

  it("POST /api/accounts", () =>
    warmThenWrite(() => POST(write("POST", CREATE_BODY)), 1));

  // Data Model - API Routes, POST /api/accounts: ids are unique even when the
  // cached account list is stale (an account created elsewhere since the warm).
  it("POST /api/accounts generates unique ids from the live list, not a stale cache", async () => {
    await callGet(getAccounts, "/api/accounts");
    data.getAllAccounts.mockResolvedValue([
      ACCOUNT,
      {
        ...ACCOUNT,
        accountId: acct(2),
        teamId: "team-ledger",
        teamName: "Ledger",
      },
    ]);
    const res = await POST(
      write("POST", { ...CREATE_BODY, teamName: "Ledger-" }),
    );
    expect(res.status).toBe(200);
    const sent = data.createAccount.mock.calls[0]?.[0] as { teamId: string };
    expect(sent.teamId).not.toBe("team-ledger");
  });

  it("PATCH /api/accounts/[id]", () =>
    warmThenWrite(() =>
      PATCH(write("PATCH", { accountName: "renamed" }), ctx()),
    ));

  it("DELETE /api/accounts/[id]", () =>
    warmThenWrite(() => DELETE(write("DELETE", {}), ctx())));

  it.each([
    ["POST", () => POST(write("POST", CREATE_BODY))],
    ["PATCH", () => PATCH(write("PATCH", { accountName: "renamed" }), ctx())],
    ["DELETE", () => DELETE(write("DELETE", {}), ctx())],
  ])(
    "a signed-in non-admin %s is 403 and neither writes nor revalidates",
    async (_method, run) => {
      auth.mockResolvedValue(NON_ADMIN_SESSION);
      await callGet(getAccounts, "/api/accounts");
      const res = await run();
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN");
      expect(data.createAccount).not.toHaveBeenCalled();
      expect(data.updateAccount).not.toHaveBeenCalled();
      expect(data.deactivateAccount).not.toHaveBeenCalled();
      expect(revalidatedTags).toEqual([]);
      await callGet(getAccounts, "/api/accounts");
      expect(data.getAllAccounts).toHaveBeenCalledTimes(1);
    },
  );

  it("an unauthenticated write neither writes nor revalidates", async () => {
    auth.mockResolvedValue(null);
    const res = await POST(write("POST", CREATE_BODY));
    expect(res.status).toBe(401);
    expect(data.createAccount).not.toHaveBeenCalled();
    expect(revalidatedTags).toEqual([]);
  });
});

describe("Cache-Control: private, no-store on API responses", () => {
  // Source: Access Control spec — Enforcement item 4.
  it("a cached read (GET /api/overview) is private, no-store", async () => {
    const res = await callOverview();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("a successful write is private, no-store", async () => {
    auth.mockResolvedValue(ADMIN_SESSION);
    const res = await POST(write("POST", CREATE_BODY));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("a cross-site account write neither writes nor revalidates", () => {
  // Source: Access Control spec — Enforcement item 6.
  it.each([
    ["POST", (r: Request) => POST(r), "POST"],
    ["PATCH", (r: Request) => PATCH(r, ctx()), "PATCH"],
    ["DELETE", (r: Request) => DELETE(r, ctx()), "DELETE"],
  ])("%s with a foreign Origin is 403", async (_name, run, method) => {
    auth.mockResolvedValue(ADMIN_SESSION);
    const req = new Request("http://localhost/api/accounts", {
      method,
      headers: {
        "content-type": "application/json",
        host: "localhost",
        origin: "https://evil.example.test",
      },
      body: JSON.stringify(method === "POST" ? CREATE_BODY : {}),
    });
    const res = await run(req);
    expect(res.status).toBe(403);
    expect(data.createAccount).not.toHaveBeenCalled();
    expect(data.updateAccount).not.toHaveBeenCalled();
    expect(data.deactivateAccount).not.toHaveBeenCalled();
    expect(revalidatedTags).toEqual([]);
  });
});

describe("rollups are cached per UTC day", () => {
  const ACCOUNTS = 100;
  const DAYS = 30;
  const dayOf = (n: number) =>
    new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10);
  const users = (n: number) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`user-${i}@company.com`, 1]),
    );
  const dayRows = (date: string) =>
    Array.from({ length: ACCOUNTS }, (_, i) =>
      buildRollup({
        date,
        accountId: acct(i + 1),
        models: {
          "claude-opus": { cost: 10, byUser: users(10) },
          "claude-sonnet": { cost: 10, byUser: users(10) },
          "claude-haiku": { cost: 10, byUser: users(10) },
        },
      }),
    );

  it("no cache entry exceeds Next's 2 MB limit for 100 accounts x 30 days", async () => {
    data.getRollupsByDate.mockImplementation(async (date: string) =>
      dayRows(date),
    );
    const wholeRange =
      DAYS * Buffer.byteLength(JSON.stringify(dayRows("2026-09-01")));
    expect(wholeRange).toBeGreaterThan(MAX_CACHE_ENTRY_BYTES);

    const from = dayOf(0);
    const to = dayOf(DAYS - 1);
    const res = await callOverview(
      `/api/overview?dateFrom=${from}&dateTo=${to}`,
    );
    expect(res.status).toBe(200);
    expect(oversizedEntries).toEqual([]);
    expect(
      Math.max(...cacheEntrySizes.map((e) => e.bytes)),
    ).toBeLessThanOrEqual(MAX_CACHE_ENTRY_BYTES);

    data.getRollupsByDate.mockClear();
    const again = await callOverview(
      `/api/overview?dateFrom=${from}&dateTo=${to}`,
    );
    expect(again.status).toBe(200);
    expect(data.getRollupsByDate).not.toHaveBeenCalled();
  });

  it("overlapping ranges reuse the per-day entries", async () => {
    await loadRangeRollups("2026-10-01", "2026-10-03");
    expect(data.getRollupsByDate).toHaveBeenCalledTimes(3);
    await loadRangeRollups("2026-10-02", "2026-10-05");
    expect(data.getRollupsByDate).toHaveBeenCalledTimes(5);
    expect(data.getRollupsByDate.mock.calls.map((c) => c[0]).sort()).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
  });

  it("a different accountId reuses the cache and is still filtered correctly", async () => {
    data.getRollupsByDate.mockImplementation(async (date: string) => [
      buildRollup({ date, accountId: acct(1) }),
      buildRollup({ date, accountId: acct(2) }),
    ]);
    const all = await loadRangeRollups("2026-10-01", "2026-10-03");
    expect(all).toHaveLength(6);
    expect(data.getRollupsByDate).toHaveBeenCalledTimes(3);

    const only2 = await loadRangeRollups("2026-10-01", "2026-10-03", acct(2));
    expect(data.getRollupsByDate).toHaveBeenCalledTimes(3);
    expect(only2).toHaveLength(3);
    expect(new Set(only2.map((r) => r.accountId))).toEqual(new Set([acct(2)]));
    expect(only2.map((r) => r.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });
});
