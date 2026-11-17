import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import {
  PROBE_ROLES,
  seedRoleProbe,
  type ProbeRole,
} from "../test/fixtures/role-probe-seed";

import {
  DEV_LOGIN_ONLY_REASON,
  E2E_PRODUCTION_SERVERS,
} from "./support/constants";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";
import { mockApi } from "./support/settings-api";

// Source: Design System "Settings Page" (unit D, 2026-11-16): tabs are routes
// (/dashboard/settings/{accounts,sync,litellm,access,audit}), the Access tab
// has a second row of sub-tabs (route segments people, visibility, roles,
// identities, sign-in), `/dashboard/settings` redirects on the server to the
// first visible tab, a tab the caller cannot use is not rendered and its URL
// is the same 404 as a missing page, old `#<slug>` links resolve to the right
// tab and sub-tab, no tab is taller than about two screens at 1440x900, and
// no tab scrolls horizontally at 375/768/1024/1440. Access Control spec -
// Permission matrix and Recent authentication (step-up returns); LiteLLM spec
// LD24 (who sees the LiteLLM tab). Implementation-phases unit D Verify.
// Runs in the role-probe Playwright project (playwright.config.ts): that dev
// server owns a DynamoDB Local table seeded with one identity per role by
// test/fixtures/role-probe-seed.ts (the team admin needs a stored admin scope).
// Sessions are forged like every e2e session; every /api/* call is fulfilled
// from fixtures (Rule 60.24). The default forged role is now the auditor, so
// each case names its role.
test.beforeAll(seedRoleProbe);

const BASE = "/dashboard/settings";
const byName = (name: string): ProbeRole => {
  const role = PROBE_ROLES.find((r) => r.name === name);
  if (!role) throw new Error(`unknown probe role ${name}`);
  return role;
};

type Signer = { oid: string; roles: string[]; authMethod?: "master" };
const sessionOf = (name: string): Signer =>
  name === "master user"
    ? { oid: "master:probe", roles: ["internal-admin"], authMethod: "master" }
    : { oid: byName(name).oid, roles: byName(name).roles };

// Slice B2 (B2-3, B2-10): the Audit tab left Settings for Management -> Audit,
// and Settings is closed to lead and user (their routes are the 404 below).
const ALL_TABS = ["AWS accounts", "Sync and data", "LiteLLM", "Access"];
const ALL_SUB = [
  "People",
  "Visibility",
  "Roles and mapping",
  "Identities",
  "Sign-in",
];

// The complete role matrix (security: never sampled, Rule 60.24a).
const MATRIX: { who: string; tabs: string[]; sub: string[] }[] = [
  { who: "internal-admin", tabs: ALL_TABS, sub: ALL_SUB },
  { who: "master user", tabs: ALL_TABS, sub: ALL_SUB },
  {
    who: "internal-org-admin",
    tabs: ["AWS accounts", "Sync and data", "LiteLLM", "Access"],
    sub: ["People", "Visibility"],
  },
  {
    who: "internal-auditor",
    tabs: ALL_TABS,
    sub: ["People", "Roles and mapping", "Identities", "Sign-in"],
  },
];

// Lead and user: Settings and every tab route are absent and 404 (Access
// Control - Navigation and landing by role: Administration is hidden for lead
// and user; B2-10).
const SETTINGS_URLS = [
  BASE,
  `${BASE}/accounts`,
  `${BASE}/sync`,
  `${BASE}/litellm`,
  `${BASE}/litellm/connection`,
  `${BASE}/litellm/guardrails`,
  `${BASE}/access`,
  `${BASE}/access/people`,
  `${BASE}/access/visibility`,
];

// URLs each role must get the 404 page for.
const FORBIDDEN: [string, string[]][] = [
  ["internal-admin", [`${BASE}/access/nope`, `${BASE}/litellm/nope`]],
  ["master user", [`${BASE}/access/nope`, `${BASE}/litellm/nope`]],
  [
    "internal-org-admin",
    [
      `${BASE}/access/roles`,
      `${BASE}/access/identities`,
      `${BASE}/access/sign-in`,
    ],
  ],
  ["internal-auditor", [`${BASE}/access/visibility`]],
  ["team-admin", SETTINGS_URLS],
  ["viewer-no-team", SETTINGS_URLS],
];

async function as(page: Page, who: string, path: string) {
  await signInAsTestUser(page.context(), sessionOf(who));
  const seen = await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await waitForHydration(page);
  return seen;
}

const tabNames = (page: Page, list: string) =>
  page
    .getByRole("tablist", { name: list })
    .getByRole("tab")
    .allTextContents()
    .then((names) => names.map((n) => n.trim()));

test.describe("settings tabs - each role sees exactly its tabs and sub-tabs", () => {
  for (const { who, tabs, sub } of MATRIX) {
    test(`${who}`, async ({ page }) => {
      await as(page, who, `${BASE}/accounts`);
      expect(await tabNames(page, "Settings sections")).toEqual(tabs);
      if (sub.length === 0) {
        await expect(
          page.getByRole("tablist", { name: "Access sections" }),
        ).toHaveCount(0);
        return;
      }
      await page.getByRole("tab", { name: "Access" }).click();
      await expect(page).toHaveURL(`${BASE}/access/people`);
      expect(await tabNames(page, "Access sections")).toEqual(sub);
    });
  }
});

test.describe("settings tabs - a tab the caller cannot use is a 404", () => {
  for (const [who, urls] of FORBIDDEN) {
    for (const url of urls) {
      test(`${who}: ${url}`, async ({ page }) => {
        const seen = await as(page, who, "/dashboard");
        // The landing page (My usage for lead and user) reads LiteLLM itself;
        // only requests made by the refused URL count. Wait for the landing's
        // post-hydration fetches (TeamPageContent: /api/litellm/me) to settle
        // so a late one is not blamed on the refused URL.
        await page.waitForLoadState("networkidle");
        const before = seen.length;
        const response = await page.goto(url);
        expect(response?.status()).toBe(404);
        await expect(page.getByText(/could not be found/i)).toBeVisible();
        // The refused tab fetched nothing from its own API (Rule 10.3).
        expect(
          seen.slice(before).filter((s) => s.path.startsWith("/api/litellm")),
        ).toEqual([]);
      });
    }
  }

  test("a missing settings page is the same 404", async ({ page }) => {
    await as(page, "internal-admin", "/dashboard");
    const response = await page.goto(`${BASE}/does-not-exist`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
  });
});

test.describe("settings tabs - redirects", () => {
  test("/dashboard/settings redirects on the server to the first visible tab", async ({
    page,
  }) => {
    await as(page, "internal-admin", "/dashboard");
    const response = await page.request.get(BASE, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers().location ?? "").toMatch(
      /\/dashboard\/settings\/accounts$/,
    );
    await page.goto(BASE);
    await expect(page).toHaveURL(`${BASE}/accounts`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();
  });

  // B2-3: the Settings audit entry redirects to Management -> Audit (Design
  // System - Routes and redirects); the target applies its own gate.
  test("/dashboard/settings/audit redirects to Management -> Audit for an auditor", async ({
    page,
  }) => {
    await as(page, "internal-auditor", `${BASE}/audit`);
    await expect(page).toHaveURL(/\/dashboard\/manage\/audit(\?|$)/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Audit log" }),
    ).toBeVisible();
  });

  test("/dashboard/settings/audit is a 404 for an org admin (the target is hidden)", async ({
    page,
  }) => {
    await as(page, "internal-org-admin", "/dashboard");
    const response = await page.goto(`${BASE}/audit`);
    expect(response?.status()).toBe(404);
  });

  test("/dashboard/settings/access redirects to the first visible sub-tab", async ({
    page,
  }) => {
    await as(page, "internal-auditor", `${BASE}/access`);
    await expect(page).toHaveURL(`${BASE}/access/people`);
  });

  // Access Control - Recent authentication: the step-up returns to
  // /dashboard/settings/access/roles#role-grants and
  // /dashboard/settings/access/sign-in#password-users (D33a).
  test("#role-grants lands on Roles and mapping, scrolled to Role grants", async ({
    page,
  }) => {
    await as(page, "internal-admin", `${BASE}#role-grants`);
    await expect(page).toHaveURL(`${BASE}/access/roles#role-grants`);
    await expect(
      page.getByRole("heading", { level: 2, name: "Role grants", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Roles and mapping" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("#password-users lands on Sign-in", async ({ page }) => {
    await as(page, "internal-admin", `${BASE}#password-users`);
    await expect(page).toHaveURL(`${BASE}/access/sign-in#password-users`);
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Password users",
        exact: true,
      }),
    ).toBeVisible();
  });

  test("#audit-log no longer resolves in Settings (the Audit tab moved to Management)", async ({
    page,
  }) => {
    await as(page, "internal-auditor", `${BASE}#audit-log`);
    await expect(page).toHaveURL(/\/dashboard\/settings\/accounts/);
  });

  test("a hash for a section the caller cannot use stays on the registry", async ({
    page,
  }) => {
    await as(page, "internal-org-admin", `${BASE}#role-grants`);
    await expect(page).toHaveURL(/\/dashboard\/settings\/accounts/);
  });
});

test.describe("settings tabs - Back works across tabs", () => {
  test("tab to tab to sub-tab, then Back twice", async ({ page }) => {
    await as(page, "internal-admin", `${BASE}/accounts`);
    await page.getByRole("tab", { name: "Sync and data" }).click();
    await expect(page).toHaveURL(`${BASE}/sync`);
    await page.getByRole("tab", { name: "Access" }).click();
    await expect(page).toHaveURL(`${BASE}/access/people`);
    await page
      .getByRole("tablist", { name: "Access sections" })
      .getByRole("tab", { name: "Sign-in" })
      .click();
    await expect(page).toHaveURL(`${BASE}/access/sign-in`);

    await page.goBack();
    await expect(page).toHaveURL(`${BASE}/access/people`);
    await expect(page.getByRole("tab", { name: "People" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Design System "Tabs vs secondary navigation": aria-current on both rows.
    await expect(page.getByRole("tab", { name: "People" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("tab", { name: "Access" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.goBack();
    await expect(page).toHaveURL(`${BASE}/sync`);
    await expect(
      page.getByRole("tab", { name: "Sync and data" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("tab", { name: "Sync and data" }),
    ).toHaveAttribute("aria-current", "page");
  });
});

// One load per route at 1440; the same page is then resized, so each tab is
// checked at every breakpoint without reloading (Rule 60.24).
const ROUTES: [string, string][] = [
  [`${BASE}/accounts`, "Account registry"],
  [`${BASE}/sync`, "Sync status"],
  [`${BASE}/litellm`, "LiteLLM"],
  [`${BASE}/access/people`, "Members"],
  [`${BASE}/access/visibility`, "Visibility"],
  [`${BASE}/access/roles`, "Role grants"],
  [`${BASE}/access/identities`, "Identity links"],
  [`${BASE}/access/sign-in`, "Password users"],
];

test.describe("settings tabs - layout and accessibility", () => {
  for (const [path, section] of ROUTES) {
    test(`${path}: axe clean, about two screens at most, no horizontal scroll at 375/768/1024/1440`, async ({
      page,
    }) => {
      await as(page, "internal-admin", path);
      await expect(
        page.getByRole("heading", { level: 1, name: "Settings" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: section, exact: true }),
      ).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        results.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);

      const height = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      expect(height).toBeLessThanOrEqual(2 * 900 * 1.1);

      for (const width of [375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          overflow.scrollWidth,
          `${path} overflows horizontally at ${width}px`,
        ).toBeLessThanOrEqual(overflow.clientWidth);
      }
    });
  }
});

// Design System "Settings Page" (~line 440): at 375 the tab row scrolls
// horizontally instead of the page; every tab stays reachable (review D
// round 1 T1).
test.describe("settings tabs - 375px tab row scrolls", () => {
  test("the tablist keeps every tab reachable (the last one scrolls into view and opens) and the page does not scroll", async ({
    page,
  }) => {
    await as(page, "internal-admin", `${BASE}/accounts`);
    await page.setViewportSize({ width: 375, height: 800 });
    const list = page.getByRole("tablist", { name: "Settings sections" });
    const last = list.getByRole("tab", { name: "Access" });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await last.click();
    await expect(page).toHaveURL(`${BASE}/access/people`);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});

// Access Control spec - Recent authentication (D33): a step-up through the
// server action returns to the section that asked (review D round 1 T2).
// The forged session is a stale dev-login ("local") session so the dialog
// offers 'Confirm with dev login', which calls stepUpWithDevLogin("role-grants").
test.describe("settings tabs - step-up returns to the right tab", () => {
  test.skip(E2E_PRODUCTION_SERVERS, DEV_LOGIN_ONLY_REASON);
  test("stepUpWithDevLogin(role-grants) from Roles and mapping lands on the Roles and mapping tab", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, {
      roles: ["internal-admin"],
      authMethod: "local",
      authTime: Math.floor(Date.now() / 1000) - 3600,
    });
    await mockApi(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/access/roles`);
    await waitForHydration(page);
    await page.getByRole("button", { name: "Grant role" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Person")
      .selectOption({ label: "Alice Adams (alice@example.com)" });
    await dialog.getByLabel("Role").selectOption({ label: "Org admin" });
    await dialog.getByLabel("Reason").fill("Finance reporting owner");
    await dialog.getByRole("button", { name: "Grant" }).click();
    const confirm = page.getByRole("dialog", { name: /confirm it's you/i });
    await confirm
      .getByRole("button", { name: "Confirm with dev login" })
      .click();
    // The fragment is optional (Next drops it from a server-action redirect);
    // the final tab path, a closed dialog and no failure text are required.
    await expect(page).toHaveURL(
      new RegExp(`${BASE}/access/roles(#role-grants)?$`),
    );
    await expect(
      page.getByRole("tab", { name: "Roles and mapping" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(confirm).toBeHidden();
    await expect(page.getByText(/couldn't confirm it's you/i)).toHaveCount(0);
  });
});
