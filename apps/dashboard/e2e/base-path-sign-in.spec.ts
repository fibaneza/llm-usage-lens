import { expect, test } from "@playwright/test";

import { E2E_BASE_PATH as P } from "./support/constants";

// Source: docs/specs/2026-05-15-design-system.md - Sign-in page, "The forms"
// (T-SI7: "sign-in under the base path"); docs/specs/2026-11-10-platform.md -
// Base path (BP-D11: the sign-in page and its redirects stay inside the
// prefix); Access Control T20, T23. Prefixed project only (production server,
// master user configured with an unusable hash, so the refusal is the generic
// state; a real password user is covered by sign-in-form.spec.ts).
const GENERIC = "Those details are not right. Check them and try again.";

test.describe("sign-in under the prefix (T-SI7)", () => {
  test("the form posts inside the prefix and a refusal shows the generic alert with no credential in the URL (T-SI4, BP-D11)", async ({
    page,
  }) => {
    const urls: string[] = [];
    page.on("request", (request) => urls.push(request.url()));
    await page.goto(`${P}/sign-in`);
    await page.getByLabel("Email", { exact: true }).fill("nobody@example.com");
    await page.getByLabel("Password", { exact: true }).fill("hunter2-secret");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: GENERIC }),
    ).toHaveText(GENERIC);
    expect(new URL(page.url()).pathname).toBe(`${P}/sign-in`);
    for (const url of [page.url(), ...urls]) {
      expect(url).not.toContain("hunter2-secret");
      expect(url).not.toContain("nobody%40example.com");
    }
  });

  test("the master form opens from its disclosure under the prefix (T-SI2)", async ({
    page,
  }) => {
    await page.goto(`${P}/sign-in`);
    await expect(page.getByLabel("Username")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign in as master user" }).click();
    await expect(page.getByLabel("Username")).toBeVisible();
  });
});
