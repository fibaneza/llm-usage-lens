import { expect, test } from "@playwright/test";

import {
  DEV_LOGIN_ONLY_REASON,
  E2E_PRODUCTION_SERVERS,
} from "./support/constants";
import { signInAsTestUser } from "./support/session";

// Contract R1 decision 7: the local login offers a role choice (the four
// global roles); the chosen role decides what the session can do.
test.describe("local login role choice", () => {
  test.skip(E2E_PRODUCTION_SERVERS, DEV_LOGIN_ONLY_REASON);
  test("offers the four global roles, defaulting to internal-admin", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    const select = page.getByLabel(/role/i);
    await expect(select).toHaveValue("internal-admin");
    for (const role of [
      "internal-admin",
      "internal-org-admin",
      "internal-auditor",
      "internal-viewer",
    ]) {
      await expect(select.locator(`option[value="${role}"]`)).toHaveCount(1);
    }
  });

  test("signing in as internal-viewer reaches the dashboard", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/role/i).selectOption("internal-viewer");
    await page
      .getByRole("button", { name: "Sign in as local developer" })
      .click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  // Source: Design System - Dev sign-in as a lead (D14); Access Control - Dev
  // login, threat T-MI2. The lead's scope comes from `pnpm db:seed`.
  test("the sign-in form offers Team lead, and choosing it signs in with the lead's stored scope (D14, T-MI2)", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    const select = page.getByLabel(/role/i);
    await expect(select.getByRole("option", { name: "Team lead" })).toHaveCount(
      1,
    );

    await select.selectOption({ label: "Team lead" });
    await expect(
      page.getByLabel("Sign in as (email or user id)"),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Sign in as team lead" }).click();

    // A lead has no global role: it lands on My usage and sees Team under
    // Management, from the stored admin scope.
    await expect(page).toHaveURL(/\/dashboard\/me/);
    const nav = page.getByRole("navigation");
    await expect(
      nav.getByRole("link", { name: "Team", exact: true }),
    ).toBeVisible();
    await expect(nav.getByRole("link", { name: "Users" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });

  test("the team lead cannot open Users or Settings (404): no global role from the seed (D14)", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/role/i).selectOption({ label: "Team lead" });
    await page.getByRole("button", { name: "Sign in as team lead" }).click();
    await expect(page).toHaveURL(/\/dashboard\/me/);

    const users = await page.goto("/dashboard/manage/users");
    expect(users?.status()).toBe(404);
    const settings = await page.goto("/dashboard/settings");
    expect(settings?.status()).toBe(404);
  });

  test("the e2e helper forges oid/tid/authMethod claims and a role", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, {
      roles: ["internal-viewer"],
      oid: "oid-1",
      tid: "tid-1",
      authMethod: "entra",
    });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
