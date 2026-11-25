import { vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";

// Test-only fixtures for the LiteLLM user page (Design System - LiteLLM user
// page, unit LP2, T-LP8; LiteLLM spec - API routes, GET
// /api/litellm/users/[litellmUserId], the 2026-11-25 amendment: `teams[]` and
// `appUser`, present only for internal-admin, internal-org-admin and
// internal-auditor). The answer carries no key, key alias or secret.
export const PROXY_USER_ID = "ll-ada";

export const PROXY_USER = {
  userId: PROXY_USER_ID,
  email: "ada@example.test",
  spend: 77.1,
  maxBudget: 150,
  daily: [{ date: "2026-11-14", spend: 4.5 }],
  enabledOperations: ["resetMemberSpend", "resetUserSpend"],
  teams: [
    {
      litellmTeamId: "ll-team-1",
      alias: "Payments LLM",
      appTeam: { teamId: "payments", name: "Payments" },
    },
    { litellmTeamId: "ll/team 2", alias: null, appTeam: null },
  ],
  appUser: {
    oid: "oid-ada",
    name: "Ada Lovelace",
    email: "ada@example.test",
    appTeam: { teamId: "payments", name: "Payments" },
  },
};

// The Organisation cap (LD23) omits spend, maxBudget, daily and combined; the
// links are not cost and stay.
export const PROXY_USER_CAPPED = {
  userId: PROXY_USER.userId,
  email: PROXY_USER.email,
  enabledOperations: PROXY_USER.enabledOperations,
  teams: PROXY_USER.teams,
  appUser: PROXY_USER.appUser,
};

export const PROXY_USER_UNLINKED = {
  ...PROXY_USER,
  teams: [],
  appUser: null,
};

// What a Lead would receive: today's answer, with neither `teams` nor `appUser`.
export const PROXY_USER_LEAD_SHAPE = {
  userId: PROXY_USER.userId,
  email: PROXY_USER.email,
  spend: PROXY_USER.spend,
  maxBudget: PROXY_USER.maxBudget,
  daily: PROXY_USER.daily,
  enabledOperations: PROXY_USER.enabledOperations,
};

export const OID_ADA = "oid-ada";

// GET /api/identities/[oid] (IdentityDetailSchema): the link version the
// Unlink write must send.
export const IDENTITY_ADA = {
  oid: OID_ADA,
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  upn: null,
  authMethod: "entra",
  createdAt: "2025-06-01T00:00:00.000Z",
  lastSignInAt: null,
  memberTeamId: "payments",
  memberVersion: 2,
  leadScopes: [],
  litellm: { state: "linked", litellmUserId: PROXY_USER_ID },
  linkVersion: 4,
  allowed: {
    editDisplayName: true,
    linkLiteLLM: true,
    unlinkLiteLLM: true,
    resetSpend: true,
    changeMembership: true,
    changeLead: true,
    editRoles: true,
    editUsageIdentities: true,
  },
};

type StubOptions = {
  user?: unknown | (() => Response);
  identity?: unknown | (() => Response);
};

export type Sent = { path: string; method: string; body: unknown };

// Stubs the page's reads and records every request (path, method, JSON body).
export function stubProxyUser(options: StubOptions = {}) {
  const calls: Sent[] = [];
  const answer = (given: unknown, fallback: unknown): Response =>
    typeof given === "function"
      ? (given as () => Response)()
      : apiResponse({ data: given ?? fallback });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({
        path: path + url.search,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      if (/^\/api\/litellm\/users\/[^/]+$/.test(path)) {
        return Promise.resolve(answer(options.user, PROXY_USER));
      }
      if (/^\/api\/litellm\/users\/[^/]+\/memberships$/.test(path)) {
        return Promise.resolve(
          apiResponse({ data: { items: [], configured: true } }),
        );
      }
      if (/^\/api\/identities\/[^/]+$/.test(path) && method === "GET") {
        return Promise.resolve(answer(options.identity, IDENTITY_ADA));
      }
      if (/^\/api\/identities\/[^/]+\/litellm-link$/.test(path)) {
        return Promise.resolve(
          apiResponse({
            data: { oid: OID_ADA, litellmUserId: null, version: 5 },
          }),
        );
      }
      if (/^\/api\/litellm\/users\/[^/]+\/reset-spend$/.test(path)) {
        return Promise.resolve(
          apiResponse({ data: { litellmUserId: PROXY_USER_ID } }),
        );
      }
      return Promise.resolve(apiError(404, "NOT_FOUND", "no stub"));
    }),
  );
  return calls;
}
