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
