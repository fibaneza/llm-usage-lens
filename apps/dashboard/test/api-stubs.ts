import type { OverviewResponse, SyncStatusResult } from "@bedrock-usage/shared";
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
};

export function stubApi(handlers: {
  overview?: Handler;
  syncStatus?: Handler;
}): ApiStub {
  const overviewUrls: URL[] = [];
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
