import { expect, test } from "@playwright/test";

import { signInAsTestUser } from "./support/session";

// System Architecture — Authentication & Access, Account-mutation role: a
// session ends 8 hours after sign-in regardless of activity, and a token with
// no recorded sign-in time is rejected (fail closed). The jwt callback returns
// null for such tokens and Auth.js then treats the visitor as signed out, so
// the proxy sends them to /sign-in. Tokens are forged with an old `signedInAt`
// instead of waiting (Rule 60.24: no wall-clock sleeps); the margins keep the
// 8-hour boundary away from the moment of the request.
const HOUR_SECONDS = 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);

test.describe("session lifetime", () => {
  test("a session signed in 7 hours ago still reaches the dashboard", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, {
      signedInAt: nowSeconds() - 7 * HOUR_SECONDS,
    });

    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Cost overview" }),
    ).toBeVisible();
  });

  test("a session signed in more than 8 hours ago is sent to /sign-in", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, {
      signedInAt: nowSeconds() - 8 * HOUR_SECONDS - 60,
    });

    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(
      page.getByRole("heading", { name: "Bedrock Cost Dashboard" }),
    ).toBeVisible();
  });

  test("a session with no recorded sign-in time is sent to /sign-in", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { signedInAt: null });

    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/sign-in/);
  });
});
