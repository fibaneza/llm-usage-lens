import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Source: docs/specs/2026-11-10-access-control.md - "Permission matrix",
// "API routes (additions)" (reads: internal-admin and internal-auditor on the
// admin-only sections), "Password users" (Setup D22: the link is shown in one
// response only and never in a URL), "Recent authentication" (D28: 'Confirm
// it's you'; no draft in the URL; no auto-replay), design-system "Settings
// Page" (Access sections; forms meet the axe / keyboard floor),
// implementation-phases Phase 4R.4 Verify ("axe clean"). Rule 60.24: every
// /api/* call is fulfilled from fixtures. The sessions are forged like every
// e2e session (e2e/support/session.ts, no auth bypass). The server resolves
// admin scopes from DynamoDB Local (none are seeded), so the table must exist,
// as for e2e/account-setup.spec.ts.
const NOW = "2026-11-10T09:00:00.000Z";

const TEAM_ROW = {
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
const DEPARTMENT_ROW = {
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
const ALICE = {
  oid: "oid-alice",
  email: "alice@example.com",
  displayName: "Alice Adams",
  authMethod: "entra",
  lastSignInAt: NOW,
};
const SETUP_TOKEN = "e2eSetupTokenAbCdEf0123456789-_xyzXYZ0123456789";
const SETUP_LINK = `http://127.0.0.1:3211/account/setup#${SETUP_TOKEN}`;

type Seen = { method: string; path: string }[];

// One fulfiller for the whole /api surface the Settings page touches.
async function mockApi(
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

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard/settings");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const heading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 2, name, exact: true });
const PENDING = "Pending and stale access";
const MATRIX = ["Members", "Team admins", "Visibility", PENDING];
const CONFIG = [
  "Group mappings",
  "Role grants",
  "Identity links",
  "Password users",
  "Per-user approval",
  "Audit log",
  "Access review",
];

test.describe("settings access sections - internal-admin", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
  });

  test("shows every access section with its data", async ({ page }) => {
    await mockApi(page);
    await openSettings(page);
    for (const name of [...MATRIX, ...CONFIG]) {
      await expect(heading(page, name)).toBeVisible();
    }
    await expect(
      page.getByRole("row", { name: /Alice Adams/ }).first(),
    ).toBeVisible();
    await expect(page.getByText("Finance reporting owner")).toBeVisible();
    await expect(
      page.getByRole("row", { name: /carol@example\.com/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /export access review/i }),
    ).toHaveAttribute("href", "/api/access-review");
    await expect(
      page.getByRole("switch", { name: "Password sign-in" }),
    ).toBeChecked();
  });

  test("the pending and stale lists show the pending invitation and the idle access with their reasons", async ({
    page,
  }) => {
    await mockApi(page);
    await openSettings(page);
    const section = page.getByRole("region", {
      name: "Pending and stale access",
    });
    await expect(
      section.getByRole("row", { name: /new\.hire@example\.com/ }),
    ).toContainText("Payments");
    const idle = section.getByRole("row", { name: /Alice Adams/ });
    await expect(idle).toContainText(/no sign-in for 90 days/i);
    await expect(idle).toContainText("2026-06-01");
  });

  test("the Members team picker lists a registry team that has no usage (F10)", async ({
    page,
  }) => {
    await mockApi(page);
    await openSettings(page);
    await expect(heading(page, "Members")).toBeVisible();
    await expect(
      page
        .getByLabel("Team", { exact: true })
        .first()
        .getByRole("option", { name: "Treasury" }),
    ).toHaveCount(1);
  });

  test("access sections have no serious or critical axe violations", async ({
    page,
  }) => {
    await mockApi(page);
    await openSettings(page);
    await expect(heading(page, "Audit log")).toBeVisible();
    const slugs = [
      "members",
      "team-admins",
      "visibility",
      "pending-access",
      "group-mappings",
      "role-grants",
      "identity-links",
      "identity-mapping",
      "password-users",
      "per-user-approval",
      "audit-log",
      "access-review",
    ];
    let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
    for (const slug of slugs) builder = builder.include(`#${slug}`);
    const results = await builder.analyze();
    expect(
      results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
  });

  test("Create password user opens by keyboard, traps focus, closes on Escape and is axe clean", async ({
    page,
  }) => {
    await mockApi(page);
    await openSettings(page);
    const trigger = page.getByRole("button", { name: "Create password user" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Work email")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include("[role='dialog']")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the setup link is shown once, never in the URL, and is gone after Done", async ({
    page,
  }) => {
    await mockApi(page);
    await openSettings(page);
    const urlBefore = page.url();
    await page.getByRole("button", { name: "Create password user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Work email").fill("gina@example.com");
    await dialog.getByLabel("Display name").fill("Gina Grey");
    await dialog.getByRole("button", { name: "Create user" }).click();
    const linkDialog = page.getByRole("dialog", { name: /setup link/i });
    await expect(linkDialog.getByLabel("Setup link")).toHaveValue(SETUP_LINK);
    expect(page.url()).toBe(urlBefore);
    await expect(page.locator("a[href*='account/setup']")).toHaveCount(0);
    await linkDialog.getByRole("button", { name: "Done" }).click();
    await expect(linkDialog).toBeHidden();
    await expect(page.locator("body")).not.toContainText(SETUP_TOKEN);
    expect(
      await page.evaluate(() =>
        JSON.stringify([
          ...Object.entries(localStorage),
          ...Object.entries(sessionStorage),
        ]),
      ),
    ).not.toContain(SETUP_TOKEN);
  });

  test("a role grant that needs re-authentication asks 'Confirm it's you' and never replays or leaks the draft", async ({
    page,
  }) => {
    const seen = await mockApi(page);
    await openSettings(page);
    const urlBefore = page.url();
    await page.getByRole("button", { name: "Grant role" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Person")
      .selectOption({ label: "Alice Adams (alice@example.com)" });
    await dialog.getByLabel("Role").selectOption({ label: "Org admin" });
    await dialog.getByLabel("Reason").fill("Finance reporting owner");
    await dialog.getByRole("button", { name: "Grant" }).click();
    const confirm = page.getByRole("dialog", { name: /confirm it's you/i });
    await expect(confirm).toBeVisible();
    await expect(
      confirm.getByRole("button", { name: "Confirm with Microsoft" }),
    ).toBeVisible();
    expect(page.url()).toBe(urlBefore);
    expect(
      seen.filter((s) => s.method === "POST" && s.path === "/api/role-grants"),
    ).toHaveLength(1);
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
  });
});

// Access Control spec - "Recent authentication" (D33): creating a password
// user with a stale authTime asks 'Confirm it's you', never replays the write
// and keeps no draft in the URL or storage.
test.describe("settings access sections - stale sign-in", () => {
  test("creating a password user with a stale authTime asks 'Confirm it's you' and does not replay", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, {
      roles: ["internal-admin"],
      authTime: Math.floor(Date.now() / 1000) - 3600,
    });
    const seen = await mockApi(page, { reauthPasswordCreate: true });
    await openSettings(page);
    const urlBefore = page.url();
    await page.getByRole("button", { name: "Create password user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Work email").fill("gina@example.com");
    await dialog.getByLabel("Display name").fill("Gina Grey");
    await dialog.getByRole("button", { name: "Create user" }).click();
    const confirm = page.getByRole("dialog", { name: /confirm it's you/i });
    await expect(confirm).toBeVisible();
    await expect(
      confirm.getByRole("button", { name: "Confirm with Microsoft" }),
    ).toBeVisible();
    expect(page.url()).toBe(urlBefore);
    expect(
      seen.filter(
        (s) => s.method === "POST" && s.path === "/api/password-users",
      ),
    ).toHaveLength(1);
    await expect(page.getByLabel("Setup link")).toHaveCount(0);
    const stored = await page.evaluate(() =>
      JSON.stringify([
        ...Object.entries(localStorage),
        ...Object.entries(sessionStorage),
      ]),
    );
    expect(stored).not.toContain("gina@example.com");
  });
});

test.describe("settings access sections - other roles", () => {
  test("internal-auditor sees the configuration sections read-only and no matrix sections", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page);
    await openSettings(page);
    for (const name of CONFIG) {
      await expect(heading(page, name)).toBeVisible();
    }
    // D34 reversed (Access Control spec): the auditor reads Pending and stale access.
    await expect(heading(page, PENDING)).toBeVisible();
    for (const name of MATRIX.filter((n) => n !== PENDING)) {
      await expect(heading(page, name)).toHaveCount(0);
    }
    for (const name of [
      "Grant role",
      "Create password user",
      "Add mapping",
      "Record approval",
      "Save links",
    ]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    await expect(
      page.getByRole("switch", { name: "Password sign-in" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("link", { name: /export access review/i }),
    ).toBeVisible();
  });

  test("internal-org-admin sees only Members, Team admins and Visibility", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await openSettings(page);
    for (const name of MATRIX) {
      await expect(heading(page, name)).toBeVisible();
    }
    for (const name of CONFIG) {
      await expect(heading(page, name)).toHaveCount(0);
    }
  });

  test("internal-viewer without a scope sees no access section", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page);
    await openSettings(page);
    for (const name of [...MATRIX, ...CONFIG]) {
      await expect(heading(page, name)).toHaveCount(0);
    }
  });
});
