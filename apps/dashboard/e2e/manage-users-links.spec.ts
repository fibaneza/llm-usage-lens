import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import {
  DEV_LOGIN_ONLY_REASON,
  E2E_PRODUCTION_SERVERS,
} from "./support/constants";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System - Management improvements, Users (D15), LiteLLM users
// tab (D16a), User link states (D16) and Dev sign-in as a lead (D14, team lead
// since 2026-11-18); Access Control - Dev login (the option exists only where
// the dev login does), threat T-MI2; implementation-phases M3 Verify. Detail
// is in the component and route tests (Rule 60.24a); this covers the real
// shell, the sign-in form and the stored-scope landing. LiteLLM and the
// directory are fulfilled from fixtures (Rule 60.24). The team lead scope
// comes from `pnpm db:seed` (the seed stores local:team-lead@localhost with a
// team admin scope), the state the E2E database is in.
const DIRECTORY = {
  items: [
    {
      oid: "oid-ada",
      displayName: "Ada Lovelace",
      email: "ada@example.test",
      authMethod: "entra",
      memberTeamId: null,
      litellm: { state: "linked", litellmUserId: "ll-ada" },
      linkVersion: 2,
      match: null,
    },
    {
      oid: "oid-bob",
      displayName: "Bob Barker",
      email: "bob@example.test",
      authMethod: "entra",
      memberTeamId: null,
      litellm: { state: "none" },
      linkVersion: 0,
      match: { litellmUserId: "ll-bob", email: "bob@example.test" },
    },
  ],
};

// The Users page decides `litellmConfigured` on the server from the stored
// connection (LiteLLM spec LD37). The harness has no way to clear a connection
// (no DELETE route, no e2e helper), and saving one would leak into later specs
// that expect the CI state (testing guide - E2E without LiteLLM), so these
// specs never change it: each reads the state and runs only the case that
// matches, whatever ran earlier in the run. The dev-login spec stores the fake
// LiteLLM connection in a local run; a fresh table (CI) has none.
async function litellmIsConfigured(context: BrowserContext) {
  await signInAsTestUser(context, { roles: ["internal-admin"] });
  const res = await context.request.get("/api/litellm/connection");
  expect(res.ok()).toBe(true);
  const { baseUrl } = (await res.json()).data as { baseUrl: string | null };
  await context.clearCookies();
  return baseUrl !== null;
}

async function mockDirectory(page: Page) {
  await page.route(/\/api\/identities\/directory/, (route) =>
    route.fulfill({ json: { data: DIRECTORY } }),
  );
}

test.describe("team lead sign-in (dev login)", () => {
  test.skip(E2E_PRODUCTION_SERVERS, DEV_LOGIN_ONLY_REASON);

  test("the sign-in form offers Team lead, and choosing it signs in with the lead's stored scope (D14, T-MI2)", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    const select = page.getByLabel(/role/i);
    await expect(
      select.locator("option", { hasText: "Team lead" }),
    ).toHaveCount(1);

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
});

test.describe("Management -> Users (D15, D16)", () => {
  test("an admin sees the people list with link states, Add user, and the step set for a pre-SSO admin", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockDirectory(page);
    await page.goto("/dashboard/manage/users");
    await waitForHydration(page);

    const people = page.getByRole("region", { name: "People" });
    await expect(people.getByText("Ada Lovelace")).toBeVisible();
    await expect(people.getByText("Linked")).toBeVisible();
    await expect(people.getByText("Bob Barker")).toBeVisible();

    await people.getByRole("button", { name: "Add user" }).click();
    const dialog = page.getByRole("dialog", { name: "Add user" });
    await expect(dialog.getByLabel("Work email")).toBeVisible();
    await expect(dialog.getByLabel("Team (optional)")).toBeVisible();
  });

  // Not configured (the CI state, testing guide - E2E without LiteLLM): the
  // page decides on the server: no link control, no match request, no LiteLLM
  // call (LD37). Runs only where the server reports not configured.
  test("with LiteLLM not configured an unlinked person has no link control and no match is requested (LD37)", async ({
    context,
    page,
  }) => {
    test.skip(
      await litellmIsConfigured(context),
      "a LiteLLM connection is stored (an earlier spec saved one); this case runs on a fresh table, as in CI",
    );
    // The dev-login spec may save the connection on another worker while this
    // runs (the only transition: not configured -> configured); a failure with
    // the state changed is not a defect, so it skips instead.
    try {
      await signInAsTestUser(context, { roles: ["internal-org-admin"] });
      const includes: (string | null)[] = [];
      await page.route(/\/api\/identities\/directory/, (route) => {
        includes.push(
          new URL(route.request().url()).searchParams.get("include"),
        );
        return route.fulfill({ json: { data: DIRECTORY } });
      });
      const writes: string[] = [];
      await page.route(/\/litellm-link$/, (route) => {
        writes.push(route.request().method());
        return route.fulfill({ status: 500, json: {} });
      });
      await page.goto("/dashboard/manage/users");
      await waitForHydration(page);

      const bob = page.getByRole("row", { name: /Bob Barker/ });
      await expect(bob).toContainText("LiteLLM not configured");
      await expect(bob.getByRole("button", { name: /link/i })).toHaveCount(0);
      expect(includes).not.toContain("litellmMatch");
      expect(writes).toEqual([]);
    } catch (error) {
      test.skip(
        await litellmIsConfigured(context),
        "a LiteLLM connection was saved by another spec during this test",
      );
      throw error;
    }
  });

  // Configured (a local run after dev-login stored the fake connection): the
  // Match found suggestion is shown and "Link" opens an AlertDialog naming
  // both sides; nothing is written until confirm (D16, Access Control D27).
  test("with LiteLLM configured Match found opens a confirm dialog naming both sides and writes nothing until confirmed (D16, D27)", async ({
    context,
    page,
  }) => {
    test.skip(
      !(await litellmIsConfigured(context)),
      "no LiteLLM connection is stored (fresh table, as in CI); the not-configured case covers this state",
    );
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockDirectory(page);
    const writes: string[] = [];
    await page.route(/\/litellm-link$/, (route) => {
      writes.push(route.request().method());
      return route.fulfill({ status: 500, json: {} });
    });
    await page.goto("/dashboard/manage/users");
    await waitForHydration(page);

    const bob = page.getByRole("row", { name: /Bob Barker/ });
    await expect(bob).toContainText("Match found");
    await bob.getByRole("button", { name: /^Link Bob Barker/ }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Bob Barker");
    await expect(dialog).toContainText("bob@example.test");
    await expect(dialog).toContainText("nothing is linked until you confirm");
    expect(writes).toEqual([]);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test("an auditor reads the people list and gets neither Add user nor a link control", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockDirectory(page);
    await page.goto("/dashboard/manage/users");
    await waitForHydration(page);

    const people = page.getByRole("region", { name: "People" });
    await expect(people.getByText("Ada Lovelace")).toBeVisible();
    await expect(people.getByRole("button", { name: /add user/i })).toHaveCount(
      0,
    );
    await expect(people.getByRole("button", { name: /link/i })).toHaveCount(0);
  });
});

test.describe("Management -> LiteLLM -> LiteLLM users list (D16a)", () => {
  test("lists users with link states; a person not in LiteLLM reads 'Not in LiteLLM', never $0", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await page.route(/\/api\/litellm\/team-links/, (route) =>
      route.fulfill({ json: { data: { items: [] } } }),
    );
    await page.route(/\/api\/litellm\/users(\?|$)/, (route) =>
      route.fulfill({
        json: {
          data: {
            page: 1,
            pageSize: 25,
            hasMore: false,
            enabledOperations: ["createUser"],
            mayLink: true,
            users: [
              {
                key: "oid-ada",
                linkState: "linked",
                appUser: {
                  oid: "oid-ada",
                  displayName: "Ada Lovelace",
                  email: "ada@example.test",
                  version: 2,
                },
                litellmUser: {
                  userId: "ll-ada",
                  email: "ada@example.test",
                  spend: 12.5,
                  maxBudget: 100,
                  teams: [],
                },
              },
              {
                key: "oid-bob",
                linkState: "none",
                appUser: {
                  oid: "oid-bob",
                  displayName: "Bob Barker",
                  email: "bob@example.test",
                  version: 0,
                },
                litellmUser: null,
              },
            ],
          },
        },
      }),
    );
    await page.goto("/dashboard/manage/litellm/users");
    await waitForHydration(page);

    const bob = page.getByRole("row", { name: /Bob Barker/ });
    await expect(bob).toContainText("Not in LiteLLM");
    await expect(bob).not.toContainText("$0");
    await expect(page.getByRole("row", { name: /Ada Lovelace/ })).toContainText(
      "$12.50",
    );
    await expect(
      bob.getByRole("button", { name: "Create and link" }),
    ).toBeVisible();
  });
});
