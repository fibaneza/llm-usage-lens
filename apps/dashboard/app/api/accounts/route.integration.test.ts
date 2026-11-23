import { AccountListSchema, apiResponseSchema } from "@llm-usage-lens/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

import { GET, POST, revalidate } from "@/app/api/accounts/route";

import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/support/test-support";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes" (GET
// /api/accounts) + "Entity: AccountMeta"; Rule 10.3, Rule 50.4, Rule 60.23.
const call = () =>
  GET(new Request("http://localhost/api/accounts"), {
    params: Promise.resolve({}),
  });

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  auth.mockReset();
});

describe("GET /api/accounts", () => {
  it("exports revalidate = 3600", () => {
    expect(revalidate).toBe(3600);
  });

  it("returns { data: [] } when there are no accounts", async () => {
    auth.mockResolvedValue({ user: { oid: "oid-test" } });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  // Reads are scoped (Access Control spec - Enforcement): a signed-in caller
  // with no recognised role or affiliation is a viewer with an empty scope.
  it.each([
    ["no roles claim", { user: { oid: "oid-test", name: "M" } }],
    [
      "an empty roles list",
      { user: { oid: "oid-test", name: "M", roles: [] } },
    ],
    [
      "other roles only",
      { user: { oid: "oid-test", name: "M", roles: ["Reader"] } },
    ],
  ])(
    "returns 200 with an empty list for a signed-in caller with %s and no affiliation",
    async (_n, session) => {
      auth.mockResolvedValue(session);
      const a = makeAccount(1);
      await loadFixtures({ accounts: [a] });
      const res = await call();
      expect(res.status).toBe(200);
      const body = apiResponseSchema(AccountListSchema).parse(await res.json());
      if (!("data" in body)) throw new Error("expected data");
      expect(body.data).toEqual([]);
    },
  );

  it("returns every account as { data: AccountMeta[] } validated by the response schema", async () => {
    auth.mockResolvedValue({
      user: { oid: "oid-test", roles: ["internal-admin"] },
    });
    const a = makeAccount(1);
    const b = makeAccount(2, { active: false });
    await loadFixtures({ accounts: [a, b] });
    const res = await call();
    expect(res.status).toBe(200);
    const body = apiResponseSchema(AccountListSchema).parse(await res.json());
    if (!("data" in body)) throw new Error("expected data");
    expect(body.data).toHaveLength(2);
    expect(body.data.map((x) => x.accountId).sort()).toEqual(
      [a.accountId, b.accountId].sort(),
    );
  });
});

// Source: docs/specs/2026-05-15-data-model.md - "API Routes", row POST
// /api/accounts (D-ST5): the server generates departmentId and
// teamId (a slug of the name, made unique) from departmentName and teamName, or
// reuses an existing one picked by name; the body is strict, so a departmentId
// or teamId field is 400; accountId stays a typed 12-digit number. 401/403/
// no-store are the route-contract suite's (Rule 60.23). PATCH is unchanged.
describe("POST /api/accounts - generated ids (D-ST5)", () => {
  const HOST = "localhost:3000";
  const post = (payload: unknown) =>
    POST(
      new Request(`http://${HOST}/api/accounts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: HOST,
          origin: `http://${HOST}`,
        },
        body: JSON.stringify(payload),
      }),
    );
  const base = (n: number, over: Record<string, unknown> = {}) => ({
    accountId: String(n).padStart(12, "0"),
    accountName: `acct-${n}`,
    departmentName: "Finance",
    teamName: "Ledger",
    region: "ap-southeast-2",
    ...over,
  });
  const created = async (res: Response) => {
    expect([200, 201]).toContain(res.status);
    const body = (await res.json()) as {
      data: { departmentId: string; teamId: string };
    };
    return body.data;
  };

  beforeEach(() => {
    auth.mockResolvedValue({
      user: { oid: "oid-test", roles: ["internal-admin"] },
    });
  });

  it("creates an account from names alone and generates non-empty ids", async () => {
    const data = await created(await post(base(1)));
    expect(data.departmentId.length).toBeGreaterThan(0);
    expect(data.teamId.length).toBeGreaterThan(0);
  });

  it.each([
    ["departmentId", { departmentId: "dept-typed" }],
    ["teamId", { teamId: "team-typed" }],
    ["both ids", { departmentId: "d", teamId: "t" }],
  ])("400 when the body carries %s (strict body)", async (_n, extra) => {
    const res = await post(base(2, extra));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
    expect((await (await GET_all()).json()).data).toEqual([]);
  });

  it("gives different teamIds to two names that slug to the same value", async () => {
    const a = await created(await post(base(3, { teamName: "Data Team" })));
    const b = await created(await post(base(4, { teamName: "data-team" })));
    expect(a.teamId).not.toBe(b.teamId);
  });

  it("gives different departmentIds to two names that slug to the same value", async () => {
    const a = await created(
      await post(base(5, { departmentName: "Research & Dev" })),
    );
    const b = await created(
      await post(base(6, { departmentName: "research dev" })),
    );
    expect(a.departmentId).not.toBe(b.departmentId);
  });

  it("reuses the ids of an existing department and team picked by the same name", async () => {
    const a = await created(await post(base(7)));
    const b = await created(await post(base(8)));
    expect(b.departmentId).toBe(a.departmentId);
    expect(b.teamId).toBe(a.teamId);
  });

  // Data Model - API Routes, POST /api/accounts: reuse is by normalised name,
  // lower(trim()), as AppTeamNameClaim does (Access Control - T-MI3), and a
  // team is scoped to its department.
  it("gives the same team name in two departments two different teamIds", async () => {
    const a = await created(
      await post(base(13, { departmentName: "Finance" })),
    );
    const b = await created(await post(base(14, { departmentName: "Sales" })));
    expect(a.teamId).not.toBe(b.teamId);
    expect(a.departmentId).not.toBe(b.departmentId);
  });

  it('gives "Ledger", "ledger " and "Ledger" in one department one teamId', async () => {
    const a = await created(await post(base(15, { teamName: "Ledger" })));
    const b = await created(await post(base(16, { teamName: "ledger " })));
    const c = await created(await post(base(17, { teamName: "Ledger" })));
    expect(b.teamId).toBe(a.teamId);
    expect(c.teamId).toBe(a.teamId);
  });

  it("reuses a departmentId for the same normalised department name", async () => {
    const a = await created(
      await post(base(18, { departmentName: "Finance" })),
    );
    const b = await created(
      await post(base(19, { departmentName: "  finance", teamName: "Audit" })),
    );
    expect(b.departmentId).toBe(a.departmentId);
  });

  it("never lets a generated id carry the appteam- prefix (registry ids stay separate)", async () => {
    const data = await created(await post(base(9, { teamName: "appteam-x" })));
    expect(data.teamId.startsWith("appteam-")).toBe(false);
  });

  it.each(["123", "12345678901a", "1234567890123", ""])(
    "400 for AWS account ID %j (still 12 digits)",
    async (accountId) => {
      const res = await post(base(10, { accountId }));
      expect(res.status).toBe(400);
    },
  );

  it("400 when departmentName or teamName is missing", async () => {
    const noDept: Record<string, unknown> = base(11);
    delete noDept.departmentName;
    expect((await post(noDept)).status).toBe(400);
    const noTeam: Record<string, unknown> = base(12);
    delete noTeam.teamName;
    expect((await post(noTeam)).status).toBe(400);
  });
});

function GET_all() {
  return call();
}
