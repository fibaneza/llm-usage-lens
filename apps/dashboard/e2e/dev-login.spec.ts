import { expect, test } from "@playwright/test";

import {
  DEV_LOGIN_ONLY_REASON,
  E2E_LITELLM_USER,
  E2E_PRODUCTION_SERVERS,
} from "./support/constants";
import { deleteStoredIdentity, seedStoredIdentity } from "./support/identity";
import { withStoredLiteLLMConnection } from "../test/fixtures/e2e-litellm-connection";

// Runs against the E2E dev server, which sets AUTH_DEV_LOGIN=true and no Entra
// vars (playwright.config.ts). Auth guide — Dev-only local login.
test.describe("dev-only local login", () => {
  test.skip(E2E_PRODUCTION_SERVERS, DEV_LOGIN_ONLY_REASON);
  test("/sign-in offers only the local developer button", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(
      page.getByRole("button", { name: "Sign in as local developer" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in with Microsoft" }),
    ).toHaveCount(0);
  });

  test("signing in as the local developer lands on /dashboard", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page
      .getByRole("button", { name: "Sign in as local developer" })
      .click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Cost overview" }),
    ).toBeVisible();
  });
});

// L3c: Access Control - Dev login (an optional identity), LiteLLM - Views by
// role ("Own usage without a stored link": findUserByEmail on the session's
// email, read server-side). The lookup runs in the dev server, so it talks to
// the standalone fake in support/fake-litellm-server.mjs (started and
// allow-listed by playwright.config.ts); withStoredLiteLLMConnection saves the
// connection through the real PUT as a forged admin and restores the previous
// state when the case ends (Rule 60.24).
// Amended L3c2: the dev login only signs in as a stored identity, so each case
// seeds its Identity row in DynamoDB Local first (support/identity.ts). The Role
// select is disabled while an identity is typed, so no case picks a role.
test.describe("dev login identity option (L3c, L3c2)", () => {
  test.skip(E2E_PRODUCTION_SERVERS, DEV_LOGIN_ONLY_REASON);
  // Both LiteLLM tests store the one shared connection; run them in order.
  // withStoredLiteLLMConnection takes the cross-worker LiteLLM state lock and
  // restores the previous state afterwards (Rule 60.24).
  test.describe.configure({ mode: "serial" });

  const SEEDED_OIDS = [
    "00000000-0000-4000-8000-0000000e2e01",
    "00000000-0000-4000-8000-0000000e2e02",
  ];

  test.afterAll(async () => {
    for (const oid of SEEDED_OIDS) await deleteStoredIdentity(oid);
  });

  test.beforeAll(async () => {
    await seedStoredIdentity({
      oid: "00000000-0000-4000-8000-0000000e2e01",
      email: E2E_LITELLM_USER.email,
      displayName: "Ada Lovelace",
      lastSeenRoles: ["internal-viewer"],
    });
    await seedStoredIdentity({
      oid: "00000000-0000-4000-8000-0000000e2e02",
      email: "nobody.here@example.test",
      displayName: "Nobody Here",
      lastSeenRoles: ["internal-viewer"],
    });
  });

  test("signing in as a LiteLLM user's email shows that user's spend in My usage (Views by role)", async ({
    browser,
    page,
  }) => {
    await withStoredLiteLLMConnection(browser, async () => {
      await page.goto("/sign-in");
      await page
        .getByLabel("Sign in as (email or user id)")
        .fill(E2E_LITELLM_USER.email.toUpperCase());
      await expect(page.getByLabel(/role/i)).toBeDisabled();
      await page
        .getByRole("button", {
          name: `Sign in as ${E2E_LITELLM_USER.email.toUpperCase()}`,
        })
        .click();
      await expect(page).toHaveURL(/\/dashboard/);

      // B2-3 / B2-11: the LiteLLM My usage view is on My usage now.
      await page.goto("/dashboard/me");
      await expect(page.getByText("$42.50")).toBeVisible();
      await expect(
        page.getByText("Your account is not linked to LiteLLM"),
      ).toHaveCount(0);
    });
  });

  test("an email unknown to LiteLLM shows the not-linked state (Views by role)", async ({
    browser,
    page,
  }) => {
    await withStoredLiteLLMConnection(browser, async () => {
      await page.goto("/sign-in");
      await page
        .getByLabel("Sign in as (email or user id)")
        .fill("nobody.here@example.test");
      await page
        .getByRole("button", { name: "Sign in as nobody.here@example.test" })
        .click();
      await expect(page).toHaveURL(/\/dashboard/);

      // B2-3 / B2-11: the LiteLLM My usage view is on My usage now.
      await page.goto("/dashboard/me");
      await expect(
        page.getByText("Your account is not linked to LiteLLM"),
      ).toBeVisible();
    });
  });

  test("an email that is not stored is refused with a visible error and no session (Dev login, L3c2)", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page
      .getByLabel("Sign in as (email or user id)")
      .fill("never.stored@example.test");
    await page
      .getByRole("button", { name: "Sign in as never.stored@example.test" })
      .click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("an invalid identity is refused with a visible error and no session (Dev login)", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page
      .getByLabel("Sign in as (email or user id)")
      .fill("not an email or an oid");
    await page
      .getByRole("button", { name: "Sign in as not an email or an oid" })
      .click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
