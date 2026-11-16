import { type BrowserContext, expect, test } from "@playwright/test";

import {
  E2E_BASE_URL,
  E2E_LITELLM_BASE_URL,
  E2E_LITELLM_USER,
} from "./support/constants";
import { signInAsTestUser } from "./support/session";

// Runs against the E2E dev server, which sets AUTH_DEV_LOGIN=true and no Entra
// vars (playwright.config.ts). Auth guide — Dev-only local login.
test.describe("dev-only local login", () => {
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
// allow-listed by playwright.config.ts); the connection is saved through the
// real PUT /api/litellm/connection as a forged admin.
async function ensureFakeLiteLLMConnection(context: BrowserContext) {
  await signInAsTestUser(context, {
    roles: ["internal-admin"],
    authTime: Math.floor(Date.now() / 1000),
  });
  const current = await context.request.get("/api/litellm/connection");
  expect(current.ok()).toBe(true);
  const status = (await current.json()).data as {
    baseUrl: string | null;
    version: number;
  };
  if (status.baseUrl !== E2E_LITELLM_BASE_URL) {
    const saved = await context.request.put("/api/litellm/connection", {
      headers: { origin: E2E_BASE_URL },
      data: {
        baseUrl: E2E_LITELLM_BASE_URL,
        version: status.version === 0 ? null : status.version,
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);
  }
  await context.clearCookies();
}

test.describe("dev login identity option (L3c)", () => {
  // Both LiteLLM tests save the one shared connection; run them in order.
  test.describe.configure({ mode: "serial" });

  test("signing in as a LiteLLM user's email shows that user's spend in My usage (Views by role)", async ({
    context,
    page,
  }) => {
    await ensureFakeLiteLLMConnection(context);
    await page.goto("/sign-in");
    await page
      .getByLabel("Sign in as (email or user id)")
      .fill(E2E_LITELLM_USER.email.toUpperCase());
    await page.getByLabel(/role/i).selectOption("internal-viewer");
    await page
      .getByRole("button", {
        name: `Sign in as ${E2E_LITELLM_USER.email.toUpperCase()}`,
      })
      .click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto("/dashboard/litellm");
    await expect(page.getByText("$42.50")).toBeVisible();
    await expect(
      page.getByText("Your account is not linked to LiteLLM"),
    ).toHaveCount(0);
  });

  test("an email unknown to LiteLLM shows the not-linked state (Views by role)", async ({
    context,
    page,
  }) => {
    await ensureFakeLiteLLMConnection(context);
    await page.goto("/sign-in");
    await page
      .getByLabel("Sign in as (email or user id)")
      .fill("nobody.here@example.test");
    await page.getByLabel(/role/i).selectOption("internal-viewer");
    await page
      .getByRole("button", { name: "Sign in as nobody.here@example.test" })
      .click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto("/dashboard/litellm");
    await expect(
      page.getByText("Your account is not linked to LiteLLM"),
    ).toBeVisible();
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
