import { randomUUID } from "node:crypto";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { expectNoBlockingViolations } from "./support/axe";
import {
  DEV_LOGIN_ONLY_REASON,
  E2E_BASE_URL,
  E2E_PRODUCTION_SERVERS,
} from "./support/constants";
import { signInAsTestUser } from "./support/session";

// Source: docs/specs/2026-05-15-design-system.md - Authentication, Sign-in page,
// "The forms (unit SI1)" and its tests T-SI1, T-SI3, T-SI4, T-SI7;
// docs/specs/2026-11-10-access-control.md - Password users (Sign-in), threats
// T20 and T23. The sign-in under the base path is in base-path-sign-in.spec.ts.
// The password user is made the real way (an admin issues the setup link, the
// person sets a password on /account/setup); the seed helper's hash is a
// placeholder no password matches. The master form needs the production
// servers (they configure the master user; the dev server has the dev login).
const GENERIC = "Those details are not right. Check them and try again.";
const PASSWORD = "correct horse battery staple";
const WIDTHS = [375, 1280] as const;

async function createPasswordUser(browser: Browser): Promise<string> {
  const email = `signin-${randomUUID()}@example.com`;
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
      data: { email, displayName: "E2E Sign In" },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { data: { setupLink: string } };
    fragment = new URL(body.data.setupLink).hash.slice(1);
  } finally {
    await admin.close();
  }
  const person = await browser.newContext({ baseURL: E2E_BASE_URL });
  try {
    const page = await person.newPage();
    await page.goto(`/account/setup#${fragment}`);
    await page.getByLabel(/^new password/i).fill(PASSWORD);
    await page.getByLabel(/^confirm new password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /^set password/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  } finally {
    await person.close();
  }
  return email;
}

async function fillPasswordForm(page: Page, email: string, password: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
}

test.describe("sign-in forms (T-SI7)", () => {
  for (const width of WIDTHS) {
    test(`the email and password form has visible labels and is axe clean at ${width}px (T-SI1, T-SI7)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/sign-in");

      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Authenticator code")).toBeVisible();
      await expect(
        page.getByText(
          "6-digit code from your authenticator app. Leave empty if you have not set one up.",
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Show password" }),
      ).toHaveAttribute("aria-pressed", "false");
      await expectNoBlockingViolations(page);
    });

    test(`the master user form opens from its disclosure and is axe clean at ${width}px (T-SI2, T-SI7)`, async ({
      page,
    }) => {
      test.skip(
        !E2E_PRODUCTION_SERVERS,
        "the master user is configured only on the production servers",
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/sign-in");

      await expect(page.getByLabel("Username")).toHaveCount(0);
      const disclosure = page.getByRole("button", {
        name: "Sign in as master user",
      });
      await disclosure.focus();
      await page.keyboard.press("Enter");
      await expect(disclosure).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByLabel("Username")).toBeVisible();
      await expectNoBlockingViolations(page);
    });
  }

  test("a password user signs in with email and password and lands on the dashboard (T-SI3)", async ({
    browser,
  }) => {
    const email = await createPasswordUser(browser);
    const context = await browser.newContext({ baseURL: E2E_BASE_URL });
    const page = await context.newPage();
    await page.goto("/sign-in");
    await fillPasswordForm(page, email, PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    expect(page.url()).not.toContain(PASSWORD);
    expect(page.url()).not.toContain(encodeURIComponent(email));
    await context.close();
  });

  test("a wrong password shows the one generic alert, focuses Email and puts no credential in any URL (T-SI4, T20, T23)", async ({
    browser,
  }) => {
    const email = await createPasswordUser(browser);
    const context = await browser.newContext({ baseURL: E2E_BASE_URL });
    const page = await context.newPage();
    const urls: string[] = [];
    page.on("request", (request) => urls.push(request.url()));
    await page.goto("/sign-in");
    await fillPasswordForm(page, email, "not the right password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    const alert = page.getByRole("alert").filter({ hasText: GENERIC });
    await expect(alert).toHaveText(GENERIC);
    await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
    await expect(page).toHaveURL(/\/sign-in$/);
    for (const url of [page.url(), ...urls]) {
      expect(url).not.toContain("not%20the%20right");
      expect(url).not.toContain("not+the+right");
      expect(url).not.toContain(encodeURIComponent(email));
    }
    await context.close();
  });

  test("an unknown email gets the same message as a wrong password (T-SI4, T20)", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await fillPasswordForm(
      page,
      `nobody-${randomUUID()}@example.com`,
      PASSWORD,
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: GENERIC }),
    ).toHaveText(GENERIC);
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("a refused master sign-in shows the same message (T-SI4)", async ({
    page,
  }) => {
    test.skip(
      !E2E_PRODUCTION_SERVERS,
      "the master user is configured only on the production servers",
    );
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sign in as master user" }).click();
    const master = page.getByRole("region", { name: "Master user" });
    await master.getByLabel("Username").fill("e2e-master");
    await master.getByLabel("Password", { exact: true }).fill("whatever");
    await master.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: GENERIC }),
    ).toHaveText(GENERIC);
    await expect(page.getByLabel("Username")).toBeFocused();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});

// Design System - Component Inventory, NativeSelect, T-FX8: the dev sign-in
// Role field keeps its chevron inside the field with room on the right.
test.describe("dev sign-in Role field chevron (T-FX8)", () => {
  test.skip(E2E_PRODUCTION_SERVERS, DEV_LOGIN_ONLY_REASON);
  for (const width of [375, 1440] as const) {
    test(`the chevron sits inside the Role select, 8px or more from its right edge, and the page is axe clean at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/sign-in");
      const select = page.getByLabel(/^role/i);
      await expect(select).toBeVisible();
      const chevron = select.locator("xpath=..").locator("svg");
      await expect(chevron).toHaveCount(1);
      const s = await select.boundingBox();
      const c = await chevron.boundingBox();
      expect(s).not.toBeNull();
      expect(c).not.toBeNull();
      if (s === null || c === null) return;
      expect(c.x).toBeGreaterThanOrEqual(s.x);
      expect(c.y).toBeGreaterThanOrEqual(s.y);
      expect(c.y + c.height).toBeLessThanOrEqual(s.y + s.height);
      expect(s.x + s.width - (c.x + c.width)).toBeGreaterThanOrEqual(8);
      await expectNoBlockingViolations(page);
    });
  }
});
