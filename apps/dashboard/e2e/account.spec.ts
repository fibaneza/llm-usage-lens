import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { E2E_BASE_URL } from "./support/constants";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Source: temp/run-r4b/decisions.md F9 (Account page at /dashboard/account: a
// password user changes their own password; a non-password session sees its
// sign-in method and no form), Access Control spec - "Password users"
// (Passwords: 12-128 characters; TOTP only when enrolled), "API routes
// (additions)" (POST /api/account/password), design-system axe floor. The
// password session is the real one: a setup link is issued by a forged
// internal-admin session (as in e2e/account-setup.spec.ts) and consumed in a
// fresh context, which signs the person in. Needs DynamoDB Local with the
// table created.
const FIRST_PASSWORD = "correct horse battery staple";
const NEXT_PASSWORD = "another sturdy purple elephant";

async function signInAsNewPasswordUser(browser: Browser) {
  const email = `account-${randomUUID()}@example.com`;
  const admin = await browser.newContext({ baseURL: E2E_BASE_URL });
  let fragment: string;
  try {
    await signInAsTestUser(admin, {
      roles: ["internal-admin"],
      oid: "e2e-admin",
      authMethod: "local",
      authTime: Math.floor(Date.now() / 1000),
    });
    const res = await admin.request.post(`${E2E_BASE_URL}/api/password-users`, {
      headers: { origin: E2E_BASE_URL },
      data: { email, displayName: "E2E Person" },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { data: { setupLink: string } };
    fragment = new URL(body.data.setupLink).hash.slice(1);
  } finally {
    await admin.close();
  }
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  await page.goto(`/account/setup#${fragment}`);
  await page.getByLabel(/^new password/i).fill(FIRST_PASSWORD);
  await page.getByLabel(/^confirm new password/i).fill(FIRST_PASSWORD);
  await page.getByRole("button", { name: /^set password/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return { context, page, email };
}

async function openAccountFromMenu(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForHydration(page);
  await page.getByRole("button", { name: "Open user menu" }).click();
  await page.getByRole("menuitem", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/dashboard\/account/);
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
}

test.describe("/dashboard/account", () => {
  test("a password user changes their password from the user menu and sees the success message", async ({
    browser,
  }) => {
    const { context, page, email } = await signInAsNewPasswordUser(browser);
    await openAccountFromMenu(page);
    await expect(page.getByText(email)).toBeVisible();
    // TOTP was not enrolled at setup, so no authenticator field.
    await expect(page.getByLabel(/authenticator code/i)).toHaveCount(0);

    await page.getByLabel(/^current password/i).fill(FIRST_PASSWORD);
    await page.getByLabel(/^new password/i).fill(NEXT_PASSWORD);
    await page.getByLabel(/^confirm new password/i).fill(NEXT_PASSWORD);
    await page.getByRole("button", { name: /^change password/i }).click();
    await expect(
      page.getByRole("form", { name: "Change password" }).getByRole("status"),
    ).toContainText(/password (has been )?changed/i);
    await expect(page.getByLabel(/^new password/i)).toHaveValue("");

    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      ),
    ).toEqual([]);
    await context.close();
  });

  test("a wrong current password shows one generic error and no success", async ({
    browser,
  }) => {
    const { context, page } = await signInAsNewPasswordUser(browser);
    await openAccountFromMenu(page);
    await page.getByLabel(/^current password/i).fill("not the right one 123");
    await page.getByLabel(/^new password/i).fill(NEXT_PASSWORD);
    await page.getByLabel(/^confirm new password/i).fill(NEXT_PASSWORD);
    await page.getByRole("button", { name: /^change password/i }).click();
    await expect(
      page.getByRole("form", { name: "Change password" }).getByRole("alert"),
    ).toContainText(/could not change .*password/i);
    await expect(
      page.getByRole("form", { name: "Change password" }).getByRole("status"),
    ).toHaveCount(0);
    await context.close();
  });

  test("an Entra session sees its sign-in method and no password form, and is axe clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { authMethod: "entra" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard/account");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(page.getByText("Microsoft Entra ID")).toBeVisible();
    await expect(page.getByLabel(/password/i)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /change password/i }),
    ).toHaveCount(0);

    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      ),
    ).toEqual([]);
  });
});
