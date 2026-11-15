import { DateRangeQuerySchema, TeamsQuerySchema } from "@llm-usage-lens/shared";
import { vi } from "vitest";

import { apiError, apiResponse } from "@/test/api-stubs";

// Test-only helpers for the Settings access sections (Phase 4R.4 step 6): a
// stubbed same-origin `fetch` (Rule 60.24 - no real network) keyed by
// "METHOD /decoded/path", recording every call with its parsed JSON body, plus
// fixtures that mirror the committed Route Handler response shapes
// (docs/specs/2026-11-10-access-control.md - "API routes (additions)").

export type Call = {
  method: string;
  path: string;
  search: string;
  url: string;
  body: unknown;
};

type Handler = (call: Call) => Response | Promise<Response>;
// A plain value is wrapped as `{ data: value }` with status 200.
export type RouteTable = Record<string, Handler | unknown>;

export type AccessApi = {
  calls: Call[];
  // Every non-GET call, in order.
  writes: () => Call[];
  // Calls matching "METHOD /path" (search ignored).
  to: (key: string) => Call[];
};

// Unmatched GETs answer 404 NOT_FOUND; an unmatched write throws so a test
// never silently passes on a request it did not expect.
export function stubAccessApi(routes: RouteTable): AccessApi {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      const path = decodeURIComponent(url.pathname);
      let body: unknown;
      if (typeof init?.body === "string") {
        body = JSON.parse(init.body) as unknown;
      }
      const call: Call = {
        method,
        path,
        search: url.search,
        url: String(input),
        body,
      };
      calls.push(call);
      const route = routes[`${method} ${path}`];
      if (route === undefined) {
        if (method === "GET") return apiError(404, "NOT_FOUND", "Not found");
        throw new Error(`unexpected write ${method} ${path}`);
      }
      return typeof route === "function"
        ? (route as Handler)(call)
        : apiResponse({ data: route });
    }),
  );
  return {
    calls,
    writes: () => calls.filter((c) => c.method !== "GET"),
    to: (key) => calls.filter((c) => `${c.method} ${c.path}` === key),
  };
}

export const ok = (data: unknown, status = 200): Response =>
  apiResponse({ data }, status);
export const fail = (status: number, code: string, message = "server text") =>
  apiError(status, code, message);
export const page = (items: unknown[], cursor?: string) => ({
  items,
  ...(cursor ? { cursor } : {}),
});

const T0 = "2026-11-10T09:00:00.000Z";

export function identityItem(
  overrides: Partial<{
    oid: string;
    email: string;
    displayName: string;
    authMethod: "entra" | "master" | "local";
  }> = {},
) {
  return {
    oid: "oid-alice",
    email: "alice@example.com",
    displayName: "Alice Adams",
    authMethod: "entra" as const,
    lastSignInAt: T0,
    ...overrides,
  };
}
export const ALICE = identityItem();
export const BOB = identityItem({
  oid: "oid-bob",
  email: "bob@example.com",
  displayName: "Bob Brown",
});

// Access Control spec - Members and Team admins (D35): in-scope member and admin rows carry the
// person's displayName and email, null when the identity is unknown.
const KNOWN_PEOPLE: Record<
  string,
  { displayName: string; email: string } | undefined
> = {
  "oid-alice": { displayName: "Alice Adams", email: "alice@example.com" },
  "oid-bob": { displayName: "Bob Brown", email: "bob@example.com" },
};
const namesOf = (oid: string) =>
  KNOWN_PEOPLE[oid] ?? { displayName: null, email: null };

export function memberItem(
  overrides: Partial<{
    oid: string;
    teamId: string;
    source: "sso" | "ui";
    version: number;
    displayName: string | null;
    email: string | null;
  }> = {},
) {
  return {
    oid: "oid-alice",
    ...namesOf(overrides.oid ?? "oid-alice"),
    teamId: "team-pay",
    source: "ui" as const,
    version: 2,
    createdAt: T0,
    updatedAt: T0,
    createdBy: "oid-admin",
    ...overrides,
  };
}

export function adminScopeItem(
  overrides: Partial<{
    oid: string;
    scopeType: "team" | "department";
    scopeId: string;
    source: "sso" | "ui";
    version: number;
    displayName: string | null;
    email: string | null;
  }> = {},
) {
  return {
    oid: "oid-bob",
    ...namesOf(overrides.oid ?? "oid-bob"),
    scopeType: "team" as const,
    scopeId: "team-pay",
    source: "ui" as const,
    version: 1,
    createdAt: T0,
    createdBy: "oid-admin",
    ...overrides,
  };
}

export function roleGrantItem(
  overrides: Partial<{
    oid: string;
    role: "internal-admin" | "internal-org-admin";
    reason: string;
    version: number;
  }> = {},
) {
  return {
    oid: "oid-alice",
    role: "internal-org-admin" as const,
    reason: "Finance reporting owner",
    grantedBy: "oid-admin",
    grantedAt: T0,
    version: 1,
    ...overrides,
  };
}

export function groupMappingItem(
  overrides: Partial<{
    groupId: string;
    target: { type: "team" | "department"; id: string };
    scopedRole: "internal-team-admin" | "member";
    version: number;
  }> = {},
) {
  return {
    groupId: "11111111-aaaa-bbbb-cccc-000000000001",
    target: { type: "team" as const, id: "team-pay" },
    scopedRole: "internal-team-admin" as const,
    version: 1,
    updatedAt: T0,
    ...overrides,
  };
}

export function passwordUserItem(
  overrides: Partial<{
    email: string;
    displayName: string;
    status: "enabled" | "disabled" | "pending-setup" | "sso-bound";
    totpEnrolled: boolean;
    version: number;
  }> = {},
) {
  return {
    email: "carol@example.com",
    displayName: "Carol Chen",
    status: "enabled" as const,
    totpEnrolled: true,
    createdAt: T0,
    version: 3,
    ...overrides,
  };
}

export function auditItem(
  overrides: Partial<{
    actor: string;
    action: string;
    category: "security" | "change";
    result: "success" | "failed" | "denied";
    code: string;
    target: { type: string; id: string };
    timestamp: string;
    requestId: string;
  }> = {},
) {
  return {
    actor: "oid-admin",
    action: "affiliation.add",
    category: "change" as const,
    target: { type: "affiliation", id: "oid-alice" },
    result: "success" as const,
    timestamp: "2026-11-15T10:00:00.000Z",
    requestId: "req-1",
    ...overrides,
  };
}

export const TEAM_ROWS = [
  teamRow("team-pay", "Payments", "dept-eng", "Engineering"),
  teamRow("team-risk", "Risk", "dept-fin", "Finance"),
];
export const DEPARTMENT_ROWS = [
  departmentRow("dept-eng", "Engineering"),
  departmentRow("dept-fin", "Finance"),
];

function teamRow(
  teamId: string,
  teamName: string,
  departmentId: string,
  departmentName: string,
) {
  return {
    teamId,
    teamName,
    departmentId,
    departmentName,
    cost: 1,
    modelCost: 1,
    nonModelCost: 0,
    inputTokens: 1,
    outputTokens: 1,
    invocations: 1,
    serviceCount: 1,
    userCount: 1,
  };
}
function departmentRow(departmentId: string, departmentName: string) {
  return {
    departmentId,
    departmentName,
    cost: 1,
    modelCost: 1,
    nonModelCost: 0,
    inputTokens: 1,
    outputTokens: 1,
    invocations: 1,
    teamCount: 1,
    topModel: "claude-sonnet",
  };
}

// GET /api/teams and /api/departments require a valid dateFrom/dateTo
// (TeamsQuerySchema / DateRangeQuerySchema; Data Model spec - "API Routes").
// Like the real routes, these answer 400 VALIDATION_ERROR otherwise, so every
// section test that loads the pickers guards the query string.
function orgList(
  schema: typeof TeamsQuerySchema | typeof DateRangeQuerySchema,
  body: unknown,
): Handler {
  return (call) => {
    const query = Object.fromEntries(new URLSearchParams(call.search));
    return schema.safeParse(query).success
      ? ok(body)
      : fail(400, "VALIDATION_ERROR", "Invalid query");
  };
}
export const teamsRoute = (rows: unknown[] = TEAM_ROWS): Handler =>
  orgList(TeamsQuerySchema, { teams: rows });
export const departmentsRoute = (rows: unknown[] = DEPARTMENT_ROWS): Handler =>
  orgList(DateRangeQuerySchema, { departments: rows });

// Access Control spec - Org units (D35): the Members, Team admins and Visibility
// pickers read the registry-backed, scope-filtered GET /api/access/org-units,
// which needs no date range. The route name is provisional until the Access
// Control spec fixes it.
export const ORG_UNITS = {
  teams: [
    { id: "team-pay", name: "Payments", departmentId: "dept-eng" },
    { id: "team-risk", name: "Risk", departmentId: "dept-fin" },
  ],
  departments: [
    { id: "dept-eng", name: "Engineering" },
    { id: "dept-fin", name: "Finance" },
  ],
};
// A registry team with no rollups: GET /api/teams cannot return it.
export const UNUSED_TEAM = {
  id: "team-new",
  name: "Treasury",
  departmentId: "dept-fin",
};

// The org pickers every access section shares (Members, Team admins,
// Visibility, Group mappings). The usage-based GET /api/teams and
// /api/departments stay stubbed only so a stray call is observable.
export const ORG_ROUTES: RouteTable = {
  "GET /api/access/org-units": ORG_UNITS,
  "GET /api/teams": teamsRoute(),
  "GET /api/departments": departmentsRoute(),
  "GET /api/identities": page([ALICE, BOB]),
};
