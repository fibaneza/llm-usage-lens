import type {
  CombinedMeResponse,
  CombinedOrganisationResponse,
  CombinedTeamResponse,
  CombinedTeamsResponse,
} from "@llm-usage-lens/shared";
import { vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";

// Test-only fixtures and a same-origin fetch stub for the L6 combined UI
// (Rule 60.24: no real network). Bodies mirror the schemas in
// packages/shared/src/schemas/combined.ts. Source: docs/specs/2026-11-10-
// litellm.md - "Combined usage and My usage (L6)": States, Visibility, the
// counted-once fixture (organisation combined 16.20, slice 5, reconciliation
// -0.20).

export const HIDDEN = {
  visibility: "hidden",
  configured: true,
  gatewayConfigured: false,
} as const;

export function orgShow(
  overrides: Record<string, unknown> = {},
): CombinedOrganisationResponse {
  return {
    visibility: "show",
    configured: true,
    gatewayConfigured: true,
    bedrockExact: 15,
    gatewaySlice: 5,
    bedrockDirect: 10,
    litellm: 6.2,
    combined: 16.2,
    byProvider: [
      { provider: "bedrock", spend: 5.2 },
      { provider: "openai", spend: 1 },
    ],
    reconciliation: {
      litellmBedrock: 5.2,
      difference: -0.2,
      differencePct: -0.04,
    },
    costEstimated: false,
    provisional: false,
    ...overrides,
  } as CombinedOrganisationResponse;
}

export const ORG_WARN = orgShow({
  visibility: "warn",
  gatewayConfigured: false,
  gatewaySlice: 0,
  bedrockDirect: 15,
  litellm: 6.2,
  combined: 21.2,
  reconciliation: null,
});

// LD37: LiteLLM is not configured -> Bedrock parts only, litellm and combined null.
export const ORG_NOT_CONFIGURED = orgShow({
  configured: false,
  litellm: null,
  combined: null,
  byProvider: [],
  reconciliation: null,
});

export function teamRow(overrides: Record<string, unknown> = {}) {
  return {
    teamId: "team-pay",
    teamName: "Payments",
    bedrockDirect: 8,
    gatewaySlice: 0,
    litellm: 3.5,
    combined: 11.5,
    costEstimated: false,
    provisional: false,
    ...overrides,
  };
}

export function teamsShow(
  teams: unknown[],
  overrides: Record<string, unknown> = {},
): CombinedTeamsResponse {
  return {
    visibility: "show",
    configured: true,
    gatewayConfigured: true,
    teams,
    ...overrides,
  } as CombinedTeamsResponse;
}

export function teamShow(
  overrides: Record<string, unknown> = {},
): CombinedTeamResponse {
  return {
    visibility: "show",
    configured: true,
    gatewayConfigured: true,
    ...teamRow(),
    ...overrides,
  } as CombinedTeamResponse;
}

export function personShow(
  overrides: Record<string, unknown> = {},
): CombinedMeResponse {
  return {
    visibility: "show",
    configured: true,
    gatewayConfigured: true,
    bedrockDirect: 10,
    litellm: 5,
    litellmUser: true,
    combined: 15,
    costEstimated: true,
    provisional: false,
    ...overrides,
  } as CombinedMeResponse;
}

export const ME_ADMIN = {
  oid: "oid-admin",
  email: "admin@example.test",
  roles: ["internal-admin"],
  usageIdentities: [],
  global: true,
  memberTeamId: null,
  memberTeamVisible: false,
  teamScopes: [] as string[],
  departmentScopes: [] as string[],
};

type Route = unknown | ((url: URL) => Response | Promise<Response>);

// Serves `{ data: body }` (or a Response from a function) per exact pathname;
// any other path answers 404. Returns the request URLs in call order.
export function stubRoutes(routes: Record<string, Route>) {
  const urls: URL[] = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    urls.push(url);
    if (!(url.pathname in routes)) {
      return apiResponse(
        { error: { code: "NOT_FOUND", message: "unexpected" } },
        404,
      );
    }
    const route = routes[url.pathname];
    return typeof route === "function"
      ? (route as (u: URL) => Response | Promise<Response>)(url)
      : apiResponse({ data: route });
  });
  vi.stubGlobal("fetch", fetchStub);
  return { urls, fetchStub };
}
