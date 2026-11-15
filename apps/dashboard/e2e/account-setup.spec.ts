import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

import { E2E_BASE_URL } from "./support/constants";
import { signInAsTestUser } from "./support/session";

// Source: docs/specs/2026-11-10-access-control.md - "Password users" (Setup
// D22: one-time link https://<host>/account/setup#<token>, the token in the
// fragment so it never reaches access logs, single use; an unknown, used or
// expired token gives one generic error), threats T24 and T25 ("R4 e2e setup",
// "setup page shows the email"). Phase 4R.4 step 5.
// The link is made the real way: an internal-admin session (forged like every
// e2e session, no auth bypass) posts to /api/password-users, which returns the
// link in exactly one response. The person then opens it in a fresh browser
// context with no session. Needs DynamoDB Local with the table created.
const GOOD_PASSWORD = "correct horse battery staple";
const INVALID_LINK = /invalid or (has )?expired/i;

async function issueSetupToken(
  browser: Browser,
  email: string,
): Promise<string> {
  const admin = await browser.newContext({ baseURL: E2E_BASE_URL });
  try {
    await signInAsTestUser(admin, {
      roles: ["internal-admin"],
      oid: "e2e-admin",
      authMethod: "local",
      authTime: Math.floor(Date.now() / 1000),
    });
    const request: APIRequestContext = admin.request;
    const res = await request.post(`${E2E_BASE_URL}/api/password-users`, {
      headers: { origin: E2E_BASE_URL },
      data: { email, displayName: "E2E Person" },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { data: { setupLink: string } };
    const fragment = new URL(body.data.setupLink).hash.slice(1);
    expect(fragment).toMatch(/^[A-Za-z0-9_-]{43}$/);
    return fragment;
  } finally {
    await admin.close();
  }
}

async function openAsAnonymous(browser: Browser, hash: string) {
  // A manual context does not inherit the config's baseURL.
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  await page.goto(`/account/setup${hash}`);
  return { context, page };
}

function noteRequestUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

test.describe("/account/setup", () => {
  test("a valid link sets the password, signs the person in and cannot be used again", async ({
    browser,
  }) => {
    const email = `setup-${randomUUID()}@example.com`;
    const token = await issueSetupToken(browser, email);

    const { context, page } = await openAsAnonymous(browser, `#${token}`);
    const urls = noteRequestUrls(page);

    // T25: the page shows whose account this is.
    await expect(page.getByText(email)).toBeVisible();

    await page.getByLabel(/^new password/i).fill(GOOD_PASSWORD);
    await page.getByLabel(/^confirm new password/i).fill(GOOD_PASSWORD);
    await page.getByRole("button", { name: /^set password/i }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    // The token and the password never appear in a URL (fragment or query).
    expect(page.url()).not.toContain(token);
    for (const url of urls) {
      expect(url).not.toContain(token);
      expect(url).not.toContain(encodeURIComponent(GOOD_PASSWORD));
    }
    await context.close();

    // Single use (D22, T24): the same link now gives the generic invalid state.
    const reuse = await openAsAnonymous(browser, `#${token}`);
    await expect(
      reuse.page.getByRole("alert").filter({ hasText: INVALID_LINK }),
    ).toBeVisible();
    await expect(reuse.page.getByLabel(/password/i)).toHaveCount(0);
    await reuse.context.close();
  });

  test("a link that never existed shows the generic invalid state with no form", async ({
    browser,
  }) => {
    const { context, page } = await openAsAnonymous(
      browser,
      `#${"A".repeat(43)}`,
    );
    await expect(
      page.getByRole("alert").filter({ hasText: INVALID_LINK }),
    ).toBeVisible();
    await expect(page.getByLabel(/password/i)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /set password/i }),
    ).toHaveCount(0);
    await context.close();
  });

  test("a page opened without the fragment shows the same invalid state", async ({
    browser,
  }) => {
    const { context, page } = await openAsAnonymous(browser, "");
    await expect(
      page.getByRole("alert").filter({ hasText: INVALID_LINK }),
    ).toBeVisible();
    await expect(page.getByLabel(/password/i)).toHaveCount(0);
    await context.close();
  });

  test("a password that is too short is refused on the page and the link stays usable", async ({
    browser,
  }) => {
    const email = `setup-${randomUUID()}@example.com`;
    const token = await issueSetupToken(browser, email);
    const { context, page } = await openAsAnonymous(browser, `#${token}`);

    await page.getByLabel(/^new password/i).fill("too short");
    await page.getByLabel(/^confirm new password/i).fill("too short");
    await page.getByRole("button", { name: /^set password/i }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /at least 12 characters/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/account\/setup/);

    await page.getByLabel(/^new password/i).fill(GOOD_PASSWORD);
    await page.getByLabel(/^confirm new password/i).fill(GOOD_PASSWORD);
    await page.getByRole("button", { name: /^set password/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await context.close();
  });

  test("is reachable without a session and is not redirected to sign-in", async ({
    browser,
  }) => {
    const { context, page } = await openAsAnonymous(
      browser,
      `#${"B".repeat(43)}`,
    );
    await expect(page).toHaveURL(/\/account\/setup/);
    await context.close();
  });
});
