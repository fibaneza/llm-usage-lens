import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { collectConsoleErrors } from "./support/console-errors";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Phase 4.9 Settings (implementation-phases -- Phase 4.9: account registry
// with Add Dialog / Edit Sheet / Deactivate confirmation, admin-only controls,
// sync status, data retention; Data Model -- API Routes, TTL and Data
// Retention; System Architecture -- Authentication & Access; Rule 60.24).
// /api/accounts and /api/sync-status are fulfilled from fixtures.
const ACCOUNTS_URL = /\/api\/accounts(\?|$)/;
const ACCOUNT_ITEM_URL = /\/api\/accounts\/\d{12}$/;
const SYNC_STATUS_URL = /\/api\/sync-status(\?|$)/;

const ACCOUNTS = [
  {
    accountId: "123456789012",
    accountName: "Payments Prod",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    teamId: "team-pay",
    teamName: "Payments",
    region: "ap-southeast-2",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    accountId: "111122223333",
    accountName: "Legacy Sandbox",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    teamId: "team-old",
    teamName: "Old",
    region: "ap-southeast-2",
    active: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
];

async function mockApi(page: Page) {
  await page.route(SYNC_STATUS_URL, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(ACCOUNTS_URL, (route) =>
    route.fulfill({ json: { data: ACCOUNTS } }),
  );
}

async function openSettings(page: Page) {
  await page.goto("/dashboard/settings");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Payments Prod")).toBeVisible();
}

test.describe("settings page -- admin", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context, { roles: ["Admin"] });
  });

  test("shows the registry (inactive marked), sync status and retention with no console errors", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    const consoleErrors = collectConsoleErrors(page);
    await mockApi(page);
    await openSettings(page);

    await expect(
      page.getByRole("row").filter({ hasText: "Legacy Sandbox" }),
    ).toContainText(/inactive/i);
    await expect(
      page.getByText(/never synced|has not synced yet/i),
    ).toBeVisible();
    await expect(page.getByText(/365 days/)).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("Add account opens a dialog; invalid input shows field errors", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    await openSettings(page);

    await page.getByRole("button", { name: /add account/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Account ID").fill("123");
    await dialog.getByRole("button", { name: "Create account" }).click();
    await expect(dialog.getByLabel("Account ID")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  test("Edit opens a Sheet with the account ID read-only", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    await openSettings(page);

    await page.getByRole("button", { name: "Edit Payments Prod" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Account ID")).toHaveValue("123456789012");
    await expect(sheet.getByLabel("Account ID")).toHaveAttribute(
      "readonly",
      "",
    );
  });

  test("Deactivate confirms, then sends DELETE", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    const deletes: string[] = [];
    await page.route(ACCOUNT_ITEM_URL, (route) => {
      deletes.push(
        `${route.request().method()} ${new URL(route.request().url()).pathname}`,
      );
      return route.fulfill({
        json: { data: { ...ACCOUNTS[0], active: false } },
      });
    });
    await openSettings(page);

    await page
      .getByRole("button", { name: "Deactivate Payments Prod" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Payments Prod");
    expect(deletes).toEqual([]);
    await dialog.getByRole("button", { name: "Deactivate" }).click();
    await expect
      .poll(() => deletes)
      .toEqual(["DELETE /api/accounts/123456789012"]);
  });

  test("creates an account: valid submit closes the dialog", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    const posts: string[] = [];
    await page.route(ACCOUNTS_URL, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posts.push(route.request().method());
      return route.fulfill({
        status: 201,
        json: {
          data: {
            ...ACCOUNTS[0],
            accountId: "000000000000",
            accountName: "New Account",
          },
        },
      });
    });
    await openSettings(page);

    await page.getByRole("button", { name: /add account/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Account ID").fill("000000000000");
    await dialog.getByLabel("Account name").fill("New Account");
    await dialog.getByLabel("Department ID").fill("dept-eng");
    await dialog.getByLabel("Department name").fill("Engineering");
    await dialog.getByLabel("Team ID").fill("team-new");
    await dialog.getByLabel("Team name").fill("New");
    await dialog.getByRole("button", { name: "Create account" }).click();
    await expect(dialog).toBeHidden();
    expect(posts).toEqual(["POST"]);
  });

  test("has no serious or critical axe violations with the Add dialog open", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    await openSettings(page);
    await page.getByRole("button", { name: /add account/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
  });

  test("has no serious or critical axe violations with the Edit sheet open", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    await openSettings(page);
    await page.getByRole("button", { name: "Edit Payments Prod" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
  });

  test("has no serious or critical axe violations", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    await openSettings(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
  });
});

test.describe("settings page -- non-admin", () => {
  test("is read-only: registry visible, no write controls", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context);
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApi(page);
    await openSettings(page);

    await expect(
      page.getByRole("button", { name: /add account/i }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^edit/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /deactivate/i })).toHaveCount(
      0,
    );
  });
});
