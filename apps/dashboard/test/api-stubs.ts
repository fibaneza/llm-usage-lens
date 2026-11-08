import type {
  DepartmentDetailResponse,
  DepartmentRow,
  OverviewResponse,
  RankingRow,
  RankingTab,
  ServiceListRow,
  SyncStatusResult,
  TeamDetailResponse,
  TeamRow,
  UserListRow,
} from "@bedrock-usage/shared";
import { vi } from "vitest";

// Test-only helpers: a stubbed same-origin `fetch` (Rule 60.24 — no real
// network) plus typed fixtures, so component tests drive the real hooks and
// `fetchApi` end to end. Bodies are validated by the production Zod schemas on
// the way in (Rule 20.11), so a fixture that drifts from the schema fails loudly.

export function apiResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

export function apiError(
  status: number,
  code = "INTERNAL_ERROR",
  message = "boom",
): Response {
  return apiResponse({ error: { code, message } }, status);
}

export const NEVER = (): Promise<Response> => new Promise<Response>(() => {});

type Handler = (url: URL) => Response | Promise<Response>;

export type ApiStub = {
  // Every `/api/overview` request's resolved date range, in call order.
  overviewRanges: () => Array<{
    dateFrom: string | null;
    dateTo: string | null;
  }>;
  syncStatusCalls: () => number;
  // Every `/api/ranking` request URL (query params included), in call order.
  rankingRequests: () => URL[];
  // Every `/api/departments` request URL (query params included), in call order.
  departmentsRequests: () => URL[];
  // Every `/api/departments/<id>` request URL, in call order.
  departmentDetailRequests: () => URL[];
  // Every `/api/teams` request URL (query params included), in call order.
  teamsRequests: () => URL[];
  // Every `/api/teams/<id>` request URL, in call order.
  teamDetailRequests: () => URL[];
  // Every `/api/services` request URL (query params included), in call order.
  servicesRequests: () => URL[];
  // Every `/api/users` request URL (query params included), in call order.
  usersRequests: () => URL[];
};

export function stubApi(handlers: {
  overview?: Handler;
  syncStatus?: Handler;
  ranking?: Handler;
  departments?: Handler;
  departmentDetail?: Handler;
  teams?: Handler;
  teamDetail?: Handler;
  services?: Handler;
  users?: Handler;
}): ApiStub {
  const overviewUrls: URL[] = [];
  const rankingUrls: URL[] = [];
  const departmentsUrls: URL[] = [];
  const departmentDetailUrls: URL[] = [];
  const teamsUrls: URL[] = [];
  const teamDetailUrls: URL[] = [];
  const servicesUrls: URL[] = [];
  const usersUrls: URL[] = [];
  let syncCalls = 0;
  const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/overview") {
      overviewUrls.push(url);
      if (!handlers.overview) throw new Error("unexpected /api/overview call");
      return handlers.overview(url);
    }
    if (url.pathname === "/api/sync-status") {
      syncCalls += 1;
      if (!handlers.syncStatus) {
        throw new Error("unexpected /api/sync-status call");
      }
      return handlers.syncStatus(url);
    }
    if (url.pathname === "/api/ranking") {
      rankingUrls.push(url);
      if (!handlers.ranking) throw new Error("unexpected /api/ranking call");
      return handlers.ranking(url);
    }
    if (url.pathname === "/api/departments") {
      departmentsUrls.push(url);
      if (!handlers.departments) {
        throw new Error("unexpected /api/departments call");
      }
      return handlers.departments(url);
    }
    if (url.pathname.startsWith("/api/departments/")) {
      departmentDetailUrls.push(url);
      if (!handlers.departmentDetail) {
        throw new Error("unexpected /api/departments/<id> call");
      }
      return handlers.departmentDetail(url);
    }
    if (url.pathname === "/api/teams") {
      teamsUrls.push(url);
      if (!handlers.teams) throw new Error("unexpected /api/teams call");
      return handlers.teams(url);
    }
    if (url.pathname.startsWith("/api/teams/")) {
      teamDetailUrls.push(url);
      if (!handlers.teamDetail) {
        throw new Error("unexpected /api/teams/<id> call");
      }
      return handlers.teamDetail(url);
    }
    if (url.pathname === "/api/services") {
      servicesUrls.push(url);
      if (!handlers.services) throw new Error("unexpected /api/services call");
      return handlers.services(url);
    }
    if (url.pathname === "/api/users") {
      usersUrls.push(url);
      if (!handlers.users) throw new Error("unexpected /api/users call");
      return handlers.users(url);
    }
    throw new Error(`unexpected fetch: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchStub);
  return {
    overviewRanges: () =>
      overviewUrls.map((url) => ({
        dateFrom: url.searchParams.get("dateFrom"),
        dateTo: url.searchParams.get("dateTo"),
      })),
    syncStatusCalls: () => syncCalls,
    rankingRequests: () => [...rankingUrls],
    departmentsRequests: () => [...departmentsUrls],
    departmentDetailRequests: () => [...departmentDetailUrls],
    teamsRequests: () => [...teamsUrls],
    teamDetailRequests: () => [...teamDetailUrls],
    servicesRequests: () => [...servicesUrls],
    usersRequests: () => [...usersUrls],
  };
}

export function overviewFixture(
  overrides: Partial<OverviewResponse> = {},
): OverviewResponse {
  return {
    totalCost: 1234.56,
    modelCost: 1000,
    nonModelCost: 234.56,
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    invocations: 2_000,
    costFinalized: true,
    activeAccounts: 7,
    mostUsedModel: "claude-opus",
    byModel: [
      {
        model: "claude-opus",
        cost: 700,
        inputTokens: 600_000,
        outputTokens: 300_000,
        invocations: 1_200,
      },
      {
        model: "claude-sonnet",
        cost: 300,
        inputTokens: 400_000,
        outputTokens: 200_000,
        invocations: 800,
      },
    ],
    nonModelByCategory: [
      { category: "guardrails", cost: 34.56, recurring: false },
      { category: "provisioned-throughput", cost: 200, recurring: true },
    ],
    dailyTrend: [
      {
        date: "2026-01-19",
        cost: 600,
        modelCost: 500,
        nonModelCost: 100,
        byModel: { "claude-opus": 350, "claude-sonnet": 150 },
      },
      {
        date: "2026-01-20",
        cost: 634.56,
        modelCost: 500,
        nonModelCost: 134.56,
        byModel: { "claude-opus": 350, "claude-sonnet": 150 },
      },
    ],
    topDepartments: [
      { departmentId: "dept-eng", departmentName: "Engineering", cost: 800 },
      {
        departmentId: "dept-data",
        departmentName: "Data Science",
        cost: 434.56,
      },
    ],
    ...overrides,
  };
}

export function emptyOverviewFixture(): OverviewResponse {
  return {
    totalCost: 0,
    modelCost: 0,
    nonModelCost: 0,
    inputTokens: 0,
    outputTokens: 0,
    invocations: 0,
    costFinalized: false,
    activeAccounts: 0,
    mostUsedModel: null,
    byModel: [],
    nonModelByCategory: [],
    dailyTrend: [],
    topDepartments: [],
  };
}

export function syncedFixture(
  overrides: Partial<
    Extract<SyncStatusResult, { state: "synced" }>["status"]
  > = {},
): SyncStatusResult {
  return {
    state: "synced",
    status: {
      lastRunAt: "2026-01-20T10:00:00.000Z",
      nextScheduledAt: "2026-01-20T11:00:00.000Z",
      status: "success",
      accountsTotal: 5,
      accountsSuccess: 5,
      accountsFailed: 0,
      errors: [],
      durationMs: 12_000,
      ...overrides,
    },
  };
}

export const NEVER_SYNCED: SyncStatusResult = { state: "never-synced" };

export function rankingRowFixture(
  overrides: Partial<RankingRow> & Pick<RankingRow, "id" | "name">,
): RankingRow {
  return {
    cost: 100,
    costEstimated: false,
    inputTokens: 1_000,
    outputTokens: 500,
    invocations: 10,
    ...overrides,
  };
}

export function rankingBody(tab: RankingTab, rows: RankingRow[]) {
  return { data: { tab, rows } };
}

// A `/api/departments` row (Data Model -- Zod Validation Schemas: department rows
// carry `teamCount` and `topModel`). Defaults describe a small active
// department; override what a case cares about.
export function departmentRowFixture(
  overrides: Partial<DepartmentRow> &
    Pick<DepartmentRow, "departmentId" | "departmentName">,
): DepartmentRow {
  return {
    cost: 100,
    modelCost: 100,
    nonModelCost: 0,
    inputTokens: 1_000,
    outputTokens: 500,
    invocations: 10,
    teamCount: 1,
    topModel: "claude-sonnet",
    ...overrides,
  };
}

export function departmentsBody(departments: DepartmentRow[]) {
  return { data: { departments } };
}

// A `/api/departments/<id>` body (Data Model -- Zod Validation Schemas,
// `DepartmentDetailResponseSchema`): the department row plus teams, trend and
// top users. Defaults describe an empty-but-valid department.
export function departmentDetailFixture(
  overrides: Partial<DepartmentDetailResponse> = {},
): DepartmentDetailResponse {
  return {
    departmentId: "dept-eng",
    departmentName: "Engineering",
    cost: 600,
    modelCost: 550,
    nonModelCost: 50,
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    invocations: 1_200,
    teamCount: 2,
    topModel: "claude-opus",
    nonModelByCategory: [],
    teams: [],
    dailyTrend: [],
    topUsers: [],
    teamTrend: [],
    ...overrides,
  };
}

export function departmentDetailBody(detail: DepartmentDetailResponse) {
  return { data: detail };
}

// A `/api/teams` row (Data Model -- Zod Validation Schemas: team rows carry
// `serviceCount` and `userCount`).
export function teamRowFixture(
  overrides: Partial<TeamRow> & Pick<TeamRow, "teamId" | "teamName">,
): TeamRow {
  return {
    departmentId: "dept-eng",
    departmentName: "Engineering",
    cost: 100,
    modelCost: 100,
    nonModelCost: 0,
    inputTokens: 1_000,
    outputTokens: 500,
    invocations: 10,
    serviceCount: 2,
    userCount: 3,
    ...overrides,
  };
}

export function teamsBody(teams: TeamRow[]) {
  return { data: { teams } };
}

// A `/api/teams/<id>` body (Data Model -- Zod Validation Schemas,
// `TeamDetailResponseSchema`): the team row plus accounts, trend, model
// breakdown, services and users. Defaults describe an empty-but-valid team.
export function teamDetailFixture(
  overrides: Partial<TeamDetailResponse> = {},
): TeamDetailResponse {
  return {
    teamId: "team-a",
    teamName: "Platform",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    cost: 600,
    modelCost: 550,
    nonModelCost: 50,
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    invocations: 1_200,
    serviceCount: 2,
    userCount: 2,
    nonModelByCategory: [],
    accounts: [],
    dailyTrend: [],
    byModel: [],
    services: [],
    users: [],
    ...overrides,
  };
}

export function teamDetailBody(detail: TeamDetailResponse) {
  return { data: detail };
}

// A `/api/services` row (Data Model -- Zod Validation Schemas,
// `ServicesResponseSchema`: one row per team and service, with the team's
// latest team and department names; decided 2026-11-06).
export function serviceListRowFixture(
  overrides: Partial<ServiceListRow> &
    Pick<ServiceListRow, "serviceName" | "teamId">,
): ServiceListRow {
  return {
    teamName: "Platform",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    cost: 100,
    costEstimated: true,
    inputTokens: 1_000,
    outputTokens: 500,
    invocations: 10,
    ...overrides,
  };
}

export function servicesBody(services: ServiceListRow[]) {
  return { data: { services } };
}

// A `/api/users` row (Data Model -- Zod Validation Schemas,
// `UsersResponseSchema`: one row per team and user, with the team's latest
// team and department names; decided 2026-11-06).
export function userListRowFixture(
  overrides: Partial<UserListRow> & Pick<UserListRow, "userId" | "teamId">,
): UserListRow {
  return {
    teamName: "Platform",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    cost: 100,
    costEstimated: true,
    inputTokens: 1_000,
    outputTokens: 500,
    invocations: 10,
    ...overrides,
  };
}

export function usersBody(users: UserListRow[]) {
  return { data: { users } };
}
