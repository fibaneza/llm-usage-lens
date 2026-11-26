import { vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";

// Test-only fixtures for the LiteLLM team page (Design System - LiteLLM team
// page, unit LP1; LiteLLM spec - API routes, GET /api/litellm/proxy-teams/
// [litellmTeamId]). The answer carries no key, key alias, token or secret.
export const PROXY_TEAM_ID = "ll-team-1";

export const PROXY_TEAM = {
  litellmTeamId: PROXY_TEAM_ID,
  alias: "Payments LLM",
  spend: 321.75,
  maxBudget: 500,
  budgetResetAt: "2026-12-01T00:00:00Z",
  memberCount: 7,
  models: ["claude-sonnet", "claude-haiku"],
  enabledOperations: ["getTeam", "resetMemberSpend", "resetMemberBudget"],
  linkedAppTeam: {
    teamId: "payments",
    name: "Payments",
    leads: [{ name: "Ada Lovelace" }, { name: "Grace Hopper" }],
  },
};

// The Organisation cap (LD23) omits spend and maxBudget.
export const PROXY_TEAM_CAPPED = {
  litellmTeamId: PROXY_TEAM.litellmTeamId,
  alias: PROXY_TEAM.alias,
  budgetResetAt: PROXY_TEAM.budgetResetAt,
  memberCount: PROXY_TEAM.memberCount,
  models: PROXY_TEAM.models,
  enabledOperations: PROXY_TEAM.enabledOperations,
  linkedAppTeam: PROXY_TEAM.linkedAppTeam,
};

export const PROXY_TEAM_UNLINKED = { ...PROXY_TEAM, linkedAppTeam: null };

export const PROXY_TEAM_MEMBERS = {
  litellmTeamId: PROXY_TEAM_ID,
  enabledOperations: ["resetMemberSpend", "resetMemberBudget"],
  items: [
    {
      userId: "ll-ada",
      email: "ada@example.test",
      spend: 6,
      maxBudget: 10,
      person: { oid: "oid-ada", name: "Ada Lovelace" },
    },
    {
      userId: "ll-zed",
      email: "zed@example.test",
      spend: 2,
      maxBudget: null,
      person: null,
    },
  ],
};

// GET /api/litellm/proxy-teams/[litellmTeamId]/daily (LiteLLM spec - API
// routes, unit LP3, T-LP12): date, spend, requests, tokens; no key, user or
// member field. The Organisation cap (LD23) omits `daily`.
export const PROXY_TEAM_DAILY = {
  litellmTeamId: PROXY_TEAM_ID,
  daily: [
    { date: "2026-11-14", spend: 4.5, requests: 30, tokens: 9000 },
    { date: "2026-11-15", spend: 2, requests: 12, tokens: 4000 },
  ],
  enabledOperations: ["getTeamDailySpend"],
};

export const PROXY_TEAM_DAILY_CAPPED = {
  litellmTeamId: PROXY_TEAM_ID,
  enabledOperations: ["getTeamDailySpend"],
};

type StubOptions = {
  team?: unknown | (() => Response);
  members?: unknown | (() => Response);
  daily?: unknown | (() => Response);
};

// Stubs the three reads of the page and records every request path.
export function stubProxyTeam(options: StubOptions = {}) {
  const calls: Array<{ path: string; method: string; search: string }> = [];
  const answer = (given: unknown, fallback: unknown): Response =>
    typeof given === "function"
      ? (given as () => Response)()
      : apiResponse({ data: given ?? fallback });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;
      calls.push({
        path,
        method: (init?.method ?? "GET").toUpperCase(),
        search: url.search,
      });
      if (/^\/api\/litellm\/proxy-teams\/[^/]+\/daily$/.test(path)) {
        return Promise.resolve(answer(options.daily, PROXY_TEAM_DAILY));
      }
      if (/^\/api\/litellm\/proxy-teams\/[^/]+\/members$/.test(path)) {
        return Promise.resolve(answer(options.members, PROXY_TEAM_MEMBERS));
      }
      if (/^\/api\/litellm\/proxy-teams\/[^/]+$/.test(path)) {
        return Promise.resolve(answer(options.team, PROXY_TEAM));
      }
      return Promise.resolve(apiError(404, "NOT_FOUND", "no stub"));
    }),
  );
  return calls;
}
