import type { Page } from "@playwright/test";

// Shared /api fixtures for the Settings specs (every /api/* call is fulfilled
// from fixtures, Rule 60.24). Moved from settings-access.spec.ts when Settings
// split into tab routes (Design System "Settings Page", unit D); the data and
// routes are unchanged.
export const NOW = "2026-11-10T09:00:00.000Z";

export const TEAM_ROW = {
  teamId: "team-pay",
  teamName: "Payments",
  departmentId: "dept-eng",
  departmentName: "Engineering",
  cost: 1,
  modelCost: 1,
  nonModelCost: 0,
  inputTokens: 1,
  outputTokens: 1,
  invocations: 1,
  serviceCount: 1,
  userCount: 1,
};
export const DEPARTMENT_ROW = {
  departmentId: "dept-eng",
  departmentName: "Engineering",
  cost: 1,
  modelCost: 1,
  nonModelCost: 0,
  inputTokens: 1,
  outputTokens: 1,
  invocations: 1,
  teamCount: 1,
  topModel: "claude-sonnet",
};
export const ALICE = {
  oid: "oid-alice",
  email: "alice@example.com",
  displayName: "Alice Adams",
  authMethod: "entra",
  lastSignInAt: NOW,
};
export const SETUP_TOKEN = "e2eSetupTokenAbCdEf0123456789-_xyzXYZ0123456789";
export const SETUP_LINK = `http://127.0.0.1:3211/account/setup#${SETUP_TOKEN}`;

export type Seen = { method: string; path: string }[];

// One fulfiller for the whole /api surface the Settings page touches.
export async function mockApi(
  page: Page,
  { reauthPasswordCreate = false }: { reauthPasswordCreate?: boolean } = {},
): Promise<Seen> {
  const seen: Seen = [];
  await page.route(/\/api\//, (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    seen.push({ method, path: pathname });
    const data = (body: unknown, status = 200) =>
      route.fulfill({ status, json: { data: body } });
    if (method === "POST" && pathname === "/api/role-grants") {
      return route.fulfill({
        status: 403,
        json: {
          error: {
            code: "REAUTH_REQUIRED",
            message: "Re-authentication required",
          },
        },
      });
    }
    if (method === "POST" && pathname === "/api/password-users") {
      if (reauthPasswordCreate) {
        return route.fulfill({
          status: 403,
          json: {
            error: {
              code: "REAUTH_REQUIRED",
              message: "Re-authentication required",
            },
          },
        });
      }
      return data(
        {
          user: {
            email: "gina@example.com",
            displayName: "Gina Grey",
            status: "pending-setup",
            totpEnrolled: false,
            createdAt: NOW,
            version: 1,
          },
          setupLink: SETUP_LINK,
        },
        201,
      );
    }
    if (method !== "GET") return route.fulfill({ status: 500, json: {} });
    switch (pathname) {
      case "/api/accounts":
        return data([]);
      // The LiteLLM tab (unit D) renders the panel unchanged.
      case "/api/litellm/connection":
        return data({
          baseUrl: "https://litellm.example.internal",
          version: 1,
          edition: "oss",
          serviceKeyConfigured: true,
        });
      case "/api/litellm/toggles":
        return data({
          version: 0,
          edition: "oss",
          ssoEnabled: false,
          operations: { createTeam: { enabled: true, source: "file" } },
        });
      case "/api/litellm/team-links":
        return data({ items: [] });
      case "/api/sync-status":
        return data({ state: "never-synced" });
      // F10 (temp/run-r4b/decisions.md): the access pickers read the
      // registry, so Treasury (no usage, absent from /api/teams) is listed.
      case "/api/access/org-units":
        return data({
          teams: [
            { id: "team-pay", name: "Payments", departmentId: "dept-eng" },
            { id: "team-new", name: "Treasury", departmentId: "dept-eng" },
          ],
          departments: [{ id: "dept-eng", name: "Engineering" }],
        });
      case "/api/teams":
        return data({ teams: [TEAM_ROW] });
      case "/api/departments":
        return data({ departments: [DEPARTMENT_ROW] });
      case "/api/identities":
        return data({ items: [ALICE] });
      case "/api/identities/oid-alice/links":
        return data({
          oid: "oid-alice",
          usageIdentities: ["alice@example.com"],
          aliases: [],
          version: 1,
          updatedAt: NOW,
        });
      case "/api/teams/team-pay/members":
        return data({
          items: [
            {
              oid: "oid-alice",
              displayName: "Alice Adams",
              email: "alice@example.com",
              teamId: "team-pay",
              source: "ui",
              version: 1,
              createdAt: NOW,
              updatedAt: NOW,
              createdBy: "oid-admin",
            },
          ],
        });
      case "/api/teams/team-pay/admins":
        return data({ items: [] });
      case "/api/teams/team-pay/visibility":
        return data({
          teamId: "team-pay",
          teamLevel: "visible",
          userLevel: "own",
          version: 0,
          updatedAt: NOW,
        });
      case "/api/departments/dept-eng/visibility":
        return data({
          departmentId: "dept-eng",
          departmentLevel: "hidden",
          maxUserLevel: "own",
          version: 0,
          updatedAt: NOW,
        });
      case "/api/group-mappings":
        return data({
          items: [
            {
              groupId: "11111111-aaaa-bbbb-cccc-000000000001",
              target: { type: "team", id: "team-pay" },
              scopedRole: "internal-team-admin",
              version: 1,
              updatedAt: NOW,
            },
          ],
        });
      case "/api/role-grants":
        return data({
          items: [
            {
              oid: "oid-alice",
              role: "internal-org-admin",
              reason: "Finance reporting owner",
              grantedBy: "oid-admin",
              grantedAt: NOW,
              version: 1,
            },
          ],
        });
      case "/api/password-users":
        return data({
          items: [
            {
              email: "carol@example.com",
              displayName: "Carol Chen",
              status: "enabled",
              totpEnrolled: true,
              createdAt: NOW,
              version: 3,
            },
          ],
        });
      case "/api/governance/password-sign-in":
        return data({ enabled: true, version: 1 });
      case "/api/governance/per-user-approval":
        return data({ approved: false });
      case "/api/governance/identity-map-rules":
        return data({ rules: [], version: 0 });
      case "/api/governance/identity-map-rules/suggestions":
        return data({ items: [] });
      // D34 reversed (user, 2026-11-15): the pending and stale lists.
      case "/api/access/pending":
        return data({
          items: [
            {
              kind: "affiliation",
              emailOrUpn: "new.hire@example.com",
              teamId: "team-pay",
              createdBy: "oid-admin",
              createdAt: NOW,
              version: 1,
            },
          ],
        });
      case "/api/access/stale":
        return data({
          items: [
            {
              reason: "inactive",
              kind: "affiliation",
              subject: "oid-alice",
              displayName: "Alice Adams",
              email: "alice@example.com",
              teamId: "team-pay",
              since: "2026-06-01T09:00:00.000Z",
            },
          ],
        });
      case "/api/audit":
        return data({
          items: [
            {
              actor: "oid-admin",
              action: "role.grant",
              category: "security",
              target: { type: "role", id: "oid-alice" },
              result: "success",
              timestamp: "2026-11-15T10:05:00.000Z",
              requestId: "req-1",
            },
          ],
        });
      default:
        return route.fulfill({
          status: 200,
          json: { error: { code: "NOT_FOUND", message: "Not found" } },
        });
    }
  });
  return seen;
}
