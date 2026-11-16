import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";
import { mockApi, SETUP_LINK, SETUP_TOKEN } from "./support/settings-api";

// Source: docs/specs/2026-11-10-access-control.md - "Permission matrix",
// "API routes (additions)" (reads: internal-admin and internal-auditor on the
// admin-only sections), "Password users" (Setup D22: the link is shown in one
// response only and never in a URL), "Recent authentication" (D28: 'Confirm
// it's you'; no draft in the URL; no auto-replay), design-system "Settings
// Page" (Access sections, now split over the Access sub-tabs
// /dashboard/settings/access/<people|visibility|roles|identities|sign-in> and
// the Audit tab /dashboard/settings/audit, unit D 2026-11-16; forms meet the
// axe / keyboard floor), implementation-phases Phase 4R.4 Verify. Rewritten
// per tab from the single-page spec: every old per-role visibility and
// interaction assertion is kept on the tab that now owns the section (the
// whole-page axe per tab lives in settings-tabs.spec.ts; the old include-based
// access axe test moved there). Rule 60.24: every /api/* call is fulfilled
// from fixtures (support/settings-api.ts). The sessions are forged like every
// e2e session (e2e/support/session.ts, no auth bypass). The server resolves
// admin scopes from DynamoDB Local (none are seeded), so the table must exist,
// as for e2e/account-setup.spec.ts.
const BASE = "/dashboard/settings";
const PEOPLE = `${BASE}/access/people`;
const VISIBILITY = `${BASE}/access/visibility`;
const ROLES = `${BASE}/access/roles`;
const IDENTITIES = `${BASE}/access/identities`;
const SIGN_IN = `${BASE}/access/sign-in`;
const AUDIT = `${BASE}/audit`;

async function open(page: Page, path: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const heading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 2, name, exact: true });
const PENDING = "Pending and stale access";

// Which sections each tab shows for an admin (Design System sub-tab table).
const ADMIN_TABS: [string, string[]][] = [
  [PEOPLE, ["Members", "Team admins", PENDING]],
  [VISIBILITY, ["Visibility"]],
  [ROLES, ["Group mappings", "Role grants"]],
  [IDENTITIES, ["Identity links", "Identity mapping"]],
  [SIGN_IN, ["Password users", "Per-user approval"]],
  [AUDIT, ["Audit log", "Access review"]],
];
const ALL_HEADINGS = ADMIN_TABS.flatMap(([, names]) => names);

test.describe("settings access tabs - internal-admin", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
  });

  for (const [path, names] of ADMIN_TABS) {
    test(`${path} shows its own sections and no other tab's`, async ({
      page,
    }) => {
      await mockApi(page);
      await open(page, path);
      for (const name of names) {
        await expect(heading(page, name)).toBeVisible();
      }
      for (const name of ALL_HEADINGS.filter((n) => !names.includes(n))) {
        await expect(heading(page, name)).toHaveCount(0);
      }
    });
  }

  test("People lists the member rows", async ({ page }) => {
    await mockApi(page);
    await open(page, PEOPLE);
    await expect(
      page.getByRole("row", { name: /Alice Adams/ }).first(),
    ).toBeVisible();
  });

  test("Roles and mapping lists the role grants", async ({ page }) => {
    await mockApi(page);
    await open(page, ROLES);
    await expect(page.getByText("Finance reporting owner")).toBeVisible();
  });

  test("Sign-in lists the password users and the password sign-in switch", async ({
    page,
  }) => {
    await mockApi(page);
    await open(page, SIGN_IN);
    await expect(
      page.getByRole("row", { name: /carol@example\.com/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Password sign-in" }),
    ).toBeChecked();
  });

  test("Audit offers the access review export", async ({ page }) => {
    await mockApi(page);
    await open(page, AUDIT);
    await expect(
      page.getByRole("link", { name: /export access review/i }),
    ).toHaveAttribute("href", "/api/access-review");
  });

  test("the pending and stale lists show the pending invitation and the idle access with their reasons", async ({
    page,
  }) => {
    await mockApi(page);
    await open(page, PEOPLE);
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
    await open(page, PEOPLE);
    await expect(heading(page, "Members")).toBeVisible();
    await expect(
      page
        .getByLabel("Team", { exact: true })
        .first()
        .getByRole("option", { name: "Treasury" }),
    ).toHaveCount(1);
  });

  test("Create password user opens by keyboard, traps focus, closes on Escape and is axe clean", async ({
    page,
  }) => {
    await mockApi(page);
    await open(page, SIGN_IN);
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
    await open(page, SIGN_IN);
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
    await open(page, ROLES);
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
test.describe("settings access tabs - stale sign-in", () => {
  test("creating a password user with a stale authTime asks 'Confirm it's you' and does not replay", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, {
      roles: ["internal-admin"],
      authTime: Math.floor(Date.now() / 1000) - 3600,
    });
    const seen = await mockApi(page, { reauthPasswordCreate: true });
    await open(page, SIGN_IN);
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

test.describe("settings access tabs - other roles", () => {
  test("internal-auditor sees the configuration tabs read-only and no matrix sections", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page);

    // Roles and mapping, Identities, Sign-in and Audit: sections visible.
    for (const [path, names] of ADMIN_TABS.filter(
      ([p]) => p !== PEOPLE && p !== VISIBILITY,
    )) {
      await open(page, path);
      for (const name of names) {
        await expect(heading(page, name)).toBeVisible();
      }
    }
    // D34 reversed (Access Control spec): the auditor reads Pending and stale
    // access, and nothing else on People.
    await open(page, PEOPLE);
    await expect(heading(page, PENDING)).toBeVisible();
    for (const name of ["Members", "Team admins"]) {
      await expect(heading(page, name)).toHaveCount(0);
    }
    // No write controls on any tab.
    for (const path of [ROLES, IDENTITIES, SIGN_IN]) {
      await open(page, path);
      for (const name of [
        "Grant role",
        "Create password user",
        "Add mapping",
        "Record approval",
        "Save links",
      ]) {
        await expect(page.getByRole("button", { name })).toHaveCount(0);
      }
    }
    await open(page, SIGN_IN);
    await expect(
      page.getByRole("switch", { name: "Password sign-in" }),
    ).toBeDisabled();
    await open(page, AUDIT);
    await expect(
      page.getByRole("link", { name: /export access review/i }),
    ).toBeVisible();
  });

  test("internal-org-admin sees Members, Team admins and Visibility only", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await open(page, PEOPLE);
    for (const name of ["Members", "Team admins", PENDING]) {
      await expect(heading(page, name)).toBeVisible();
    }
    await open(page, VISIBILITY);
    await expect(heading(page, "Visibility")).toBeVisible();
    // The configuration tabs are not rendered in the tab rows.
    for (const name of ["Roles and mapping", "Identities", "Sign-in"]) {
      await expect(page.getByRole("tab", { name })).toHaveCount(0);
    }
    await expect(page.getByRole("tab", { name: "Audit" })).toHaveCount(0);
  });

  test("internal-viewer without a scope sees no access section or Access tab", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page);
    await open(page, `${BASE}/accounts`);
    for (const name of ALL_HEADINGS) {
      await expect(heading(page, name)).toHaveCount(0);
    }
    await expect(page.getByRole("tab", { name: "Access" })).toHaveCount(0);
  });
});
