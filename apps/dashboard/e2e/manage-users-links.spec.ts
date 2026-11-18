import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

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

// Project standard (accessibility.spec.ts): WCAG 2 A/AA, serious or critical.
async function expectNoBlockingViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target.join(" ")),
      })),
  ).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );
}

async function mockDirectory(page: Page) {
  await page.route(/\/api\/identities\/directory/, (route) =>
    route.fulfill({ json: { data: DIRECTORY } }),
  );
}

test.describe("Management -> Users (D15, D16)", () => {
  test("an admin sees the people list with link states and an Add user dialog with the password step, no serious axe violation at 375 (D15, D16)", async ({
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
    await expect(dialog.getByLabel("Create a password sign-in")).toBeChecked();

    await page.setViewportSize({ width: 375, height: 800 });
    await expectNoBlockingViolations(page);
    expect(await noHorizontalScroll(page)).toBe(true);
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

// Deterministic in both modes: the list and the search are fulfilled, so the
// result never depends on a stored connection (Rule 60.24).
test.describe("Management -> LiteLLM users: link to an existing user (D16, T-MI1)", () => {
  test("picking a user needs a reason, shows the audit notice, and sends a manual link with the reason; axe and no scroll at 375 with the dialog open", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, {
      roles: ["internal-admin"],
      oid: "oid-e2e-admin",
    });
    await page.route(/\/api\/litellm\/team-links/, (route) =>
      route.fulfill({ json: { data: { items: [] } } }),
    );
    let searchQuery: string | null = null;
    await page.route(/\/api\/litellm\/users(\?|$)/, (route) => {
      const q = new URL(route.request().url()).searchParams.get("q");
      if (q !== null) {
        searchQuery = q;
        return route.fulfill({
          json: {
            data: {
              page: 1,
              pageSize: 25,
              hasMore: false,
              enabledOperations: ["createUser"],
              mayLink: true,
              users: [
                {
                  userId: "ll-robert",
                  email: "robert.barker@other.example.test",
                  spend: 0,
                  maxBudget: null,
                  teams: [],
                },
              ],
            },
          },
        });
      }
      return route.fulfill({
        json: {
          data: {
            page: 1,
            pageSize: 25,
            hasMore: false,
            enabledOperations: ["createUser"],
            mayLink: true,
            users: [
              {
                key: "oid-bob",
                linkState: "none",
                appUser: {
                  oid: "oid-bob",
                  displayName: "Bob Barker",
                  email: "bob@example.test",
                  version: 3,
                },
                litellmUser: null,
              },
            ],
          },
        },
      });
    });
    const bodies: Record<string, unknown>[] = [];
    await page.route(/\/api\/identities\/oid-bob\/litellm-link$/, (route) => {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        json: {
          data: { oid: "oid-bob", litellmUserId: "ll-robert", version: 4 },
        },
      });
    });

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/dashboard/manage/litellm/users");
    await waitForHydration(page);
    // Below md the list is cards (listitem), not table rows.
    const bob = page.getByRole("listitem").filter({ hasText: "Bob Barker" });
    await expect(bob).toContainText("No LiteLLM user with that email");
    await expectNoBlockingViolations(page);

    await bob
      .getByRole("button", { name: "Link to an existing LiteLLM user" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Link to an existing LiteLLM user",
    });
    await expect(dialog).toContainText("recorded in the audit log");

    await dialog.getByLabel("Search LiteLLM users").fill("robert");
    await dialog.getByRole("radio", { name: /robert\.barker/ }).check();
    expect(searchQuery).toBe("robert");

    // No reason yet: the write is refused in the form and nothing is sent.
    await dialog.getByRole("button", { name: "Link user" }).click();
    await expect(dialog).toContainText("Give a reason");
    expect(bodies).toEqual([]);

    await expectNoBlockingViolations(page);
    expect(await noHorizontalScroll(page)).toBe(true);

    await dialog.getByLabel("Reason").fill("Contractor uses a personal email");
    await dialog.getByRole("button", { name: "Link user" }).click();
    await expect(dialog).toHaveCount(0);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      litellmUserId: "ll-robert",
      mode: "manual",
      reason: "Contractor uses a personal email",
      version: 3,
    });
  });
});
