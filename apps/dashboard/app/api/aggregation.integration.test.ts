import {
  DepartmentDetailResponseSchema,
  DepartmentsResponseSchema,
  OverviewResponseSchema,
  RankingResponseSchema,
  ServicesResponseSchema,
  TeamDetailResponseSchema,
  TeamsResponseSchema,
  UsersResponseSchema,
  apiSuccessSchema,
  ApiErrorBodySchema,
} from "@llm-usage-lens/shared";
import type { z } from "zod";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { buildRollup } from "@/test/rollup-builder";
import {
  clearTable,
  putRaw,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/test-support";

import { GET as getDepartmentDetail } from "./departments/[id]/route";
import { GET as getDepartments } from "./departments/route";
import { GET as getOverview } from "./overview/route";
import { GET as getRanking } from "./ranking/route";
import { GET as getServices } from "./services/route";
import { GET as getTeamDetail } from "./teams/[id]/route";
import { GET as getTeams } from "./teams/route";
import { GET as getUsers } from "./users/route";

// Source: docs/specs/2026-05-15-implementation-phases.md — Phase 3.3 Verify;
// docs/specs/2026-05-15-data-model.md — "API Routes", "In-Memory Aggregation";
// Rules 10.3, 20.8, 20.11, 50.4, 60.23. Only the session (`@/auth`) is mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-02";
const eng = makeAccount(1);
const fin = makeAccount(3, {
  departmentId: "dept-finance",
  departmentName: "Finance",
  teamId: "team-ledger",
  teamName: "Ledger",
});

type Handler = (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

const call = (handler: unknown, url: string, id = "x") =>
  (handler as Handler)(new Request(`http://localhost${url}`), {
    params: Promise.resolve({ id }),
  });

function signedIn(on: boolean) {
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    on
      ? {
          user: {
            oid: "oid-test",
            name: "Test",
            email: "t@company.com",
            roles: ["internal-admin"],
          },
        }
      : null,
  );
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  signedIn(true);
  await clearTable();
  await loadFixtures({
    accounts: [eng, fin],
    rollups: [
      buildRollup({
        date: "2026-10-01",
        accountId: eng.accountId,
        models: {
          "claude-sonnet": {
            cost: 10,
            byUser: { "a@x.com": 10 },
            byService: { "payments-api": 10 },
          },
        },
        nonModel: { guardrails: { cost: 1, recurring: false } },
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: fin.accountId,
        departmentId: "dept-finance",
        departmentName: "Finance",
        teamId: "team-ledger",
        teamName: "Ledger",
        models: {},
        nonModel: { "provisioned-throughput": { cost: 20, recurring: true } },
      }),
    ],
  });
});

const routes: {
  name: string;
  handler: unknown;
  path: string;
  schema: z.ZodType;
  id?: string;
}[] = [
  {
    name: "overview",
    handler: getOverview,
    path: "/api/overview",
    schema: OverviewResponseSchema,
  },
  {
    name: "ranking",
    handler: getRanking,
    path: "/api/ranking",
    schema: RankingResponseSchema,
  },
  {
    name: "departments",
    handler: getDepartments,
    path: "/api/departments",
    schema: DepartmentsResponseSchema,
  },
  {
    name: "departments/[id]",
    handler: getDepartmentDetail,
    path: "/api/departments/dept-engineering",
    schema: DepartmentDetailResponseSchema,
    id: "dept-engineering",
  },
  {
    name: "teams",
    handler: getTeams,
    path: "/api/teams",
    schema: TeamsResponseSchema,
  },
  {
    name: "teams/[id]",
    handler: getTeamDetail,
    path: "/api/teams/team-payments",
    schema: TeamDetailResponseSchema,
    id: "team-payments",
  },
  {
    name: "services",
    handler: getServices,
    path: "/api/services",
    schema: ServicesResponseSchema,
  },
  {
    name: "users",
    handler: getUsers,
    path: "/api/users",
    schema: UsersResponseSchema,
  },
];

const query = (name: string, extra = "") =>
  `${RANGE}${name === "ranking" ? "&tab=departments" : ""}${extra}`;

describe.each(routes)("GET /api/$name", (route) => {
  const url = (q: string) => `${route.path}?${q}`;

  it("returns 401 UNAUTHORIZED without a session and no data", async () => {
    signedIn(false);
    const res = await call(route.handler, url(query(route.name)), route.id);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(ApiErrorBodySchema.parse(body).error.code).toBe("UNAUTHORIZED");
    expect(body).not.toHaveProperty("data");
  });

  it("returns 400 BAD_REQUEST for malformed dates", async () => {
    const res = await call(
      route.handler,
      url("dateFrom=nope&dateTo=2026-10-02&tab=departments"),
      route.id,
    );
    expect(res.status).toBe(400);
    expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
      "BAD_REQUEST",
    );
  });

  it("returns 400 when the range exceeds 90 days", async () => {
    const res = await call(
      route.handler,
      url("dateFrom=2026-01-01&dateTo=2026-10-02&tab=departments"),
      route.id,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the range is missing", async () => {
    const res = await call(route.handler, route.path, route.id);
    expect(res.status).toBe(400);
  });

  it("returns { data } that validates against the response schema", async () => {
    const res = await call(route.handler, url(query(route.name)), route.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(apiSuccessSchema(route.schema).safeParse(body).success).toBe(true);
  });
});

describe("route specifics", () => {
  it("ranking rejects an unknown tab with 400", async () => {
    const res = await call(getRanking, `/api/ranking?${RANGE}&tab=bogus`);
    expect(res.status).toBe(400);
  });

  it("overview shows idle Provisioned Throughput as non-model cost", async () => {
    const res = await call(getOverview, `/api/overview?${RANGE}`);
    const { data } = await res.json();
    expect(data.totalCost).toBeCloseTo(31);
    expect(data.nonModelCost).toBeCloseTo(21);
    expect(data.nonModelByCategory).toEqual(
      expect.arrayContaining([
        { category: "provisioned-throughput", cost: 20, recurring: true },
      ]),
    );
  });

  it("users and services views exclude non-model cost and are estimated", async () => {
    const users = await (await call(getUsers, `/api/users?${RANGE}`)).json();
    expect(users.data.users[0]).toMatchObject({
      userId: "a@x.com",
      cost: 10,
      costEstimated: true,
    });
    const services = await (
      await call(getServices, `/api/services?${RANGE}`)
    ).json();
    expect(services.data.services[0]).toMatchObject({
      serviceName: "payments-api",
      cost: 10,
      costEstimated: true,
    });
  });

  it("teams filters by departmentId", async () => {
    const res = await call(
      getTeams,
      `/api/teams?${RANGE}&departmentId=dept-finance`,
    );
    const body = await res.json();
    expect(body.data.teams.map((t: { teamId: string }) => t.teamId)).toEqual([
      "team-ledger",
    ]);
  });

  it("departments/[id] returns 404 NOT_FOUND for an unknown department", async () => {
    const res = await call(
      getDepartmentDetail,
      `/api/departments/dept-nope?${RANGE}`,
      "dept-nope",
    );
    expect(res.status).toBe(404);
    expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("teams/[id] returns 404 NOT_FOUND for an unknown team", async () => {
    const res = await call(
      getTeamDetail,
      `/api/teams/team-nope?${RANGE}`,
      "team-nope",
    );
    expect(res.status).toBe(404);
    expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("overview carries byModel, trend byModel, mostUsedModel and activeAccounts", async () => {
    const { data } = await (
      await call(getOverview, `/api/overview?${RANGE}`)
    ).json();
    expect(data.byModel).toEqual([
      {
        model: "claude-sonnet",
        cost: 10,
        inputTokens: 1000,
        outputTokens: 500,
        invocations: 2,
      },
    ]);
    expect(data.dailyTrend[0].byModel).toEqual({ "claude-sonnet": 10 });
    expect(data.mostUsedModel).toBe("claude-sonnet");
    expect(data.activeAccounts).toBe(2);
  });

  it("departments/[id] carries topUsers and teamTrend", async () => {
    const { data } = await (
      await call(
        getDepartmentDetail,
        `/api/departments/dept-engineering?${RANGE}`,
        "dept-engineering",
      )
    ).json();
    expect(data.topUsers[0]).toMatchObject({
      userId: "a@x.com",
      cost: 10,
      costEstimated: true,
    });
    expect(data.teamTrend).toEqual([
      { date: "2026-10-01", teams: [{ teamId: "team-payments", cost: 11 }] },
    ]);
  });

  it("teams/[id] carries services, users and byModel", async () => {
    const { data } = await (
      await call(
        getTeamDetail,
        `/api/teams/team-payments?${RANGE}`,
        "team-payments",
      )
    ).json();
    expect(data.services[0]).toMatchObject({
      serviceName: "payments-api",
      cost: 10,
      costEstimated: true,
    });
    expect(data.users[0]).toMatchObject({
      userId: "a@x.com",
      cost: 10,
      costEstimated: true,
    });
    expect(data.byModel).toEqual([
      expect.objectContaining({ model: "claude-sonnet", cost: 10 }),
    ]);
  });

  it("returns 500 INTERNAL (generic message) when a stored item is malformed", async () => {
    await putRaw({
      PK: "ACCT#bad",
      SK: "META",
      gsi1pk: "DEPT#dept-engineering",
      gsi1sk: "ACCT#bad",
      accountId: "bad",
      accountName: "",
    });
    const res = await call(
      getDepartmentDetail,
      `/api/departments/dept-engineering?${RANGE}`,
      "dept-engineering",
    );
    expect(res.status).toBe(500);
    const body = ApiErrorBodySchema.parse(await res.json());
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toMatch(/accountName|accountId/);
  });

  it("overview costFinalized is false when a rollup in range is not finalized", async () => {
    await loadFixtures({
      rollups: [
        {
          ...buildRollup({
            date: "2026-10-02",
            accountId: eng.accountId,
            models: { "claude-sonnet": { cost: 1 } },
          }),
          costFinalized: false,
        },
      ],
    });
    const { data } = await (
      await call(getOverview, `/api/overview?${RANGE}`)
    ).json();
    expect(data.costFinalized).toBe(false);
  });
});
