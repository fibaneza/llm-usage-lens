import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System -- Management pages, New team (unit M2, D5, D6: the
// button for admin and org-admin only; a dialog with "Team name" and
// "Department"; the new team becomes the selected team); Access Control --
// Created app teams (duplicate name against created and registry teams,
// T-MI3); App Teams spec -- Teams without an AWS account (no $0 Bedrock row on
// Cost by team). The create route's rules (403 before parsing, 409, id
// generation) are tested in the route's own file and the route-contract suite
// (Rule 60.24a); this is the journey. The lead's missing button is in
// role-landing.spec.ts (probe identity). The spec writes to the shared e2e
// table: each run creates one team with a name unique to the run and asserts
// nothing a second run would break. Created teams are not cleaned up: the
// gate's fresh seed (`pnpm db:seed:empty && pnpm db:seed`) resets them, and CI
// starts from a fresh table. LiteLLM's browser calls are fulfilled
// from fixtures (docs/guides/testing.md -- E2E without LiteLLM).
const SEEDED_TEAM = "Platform Guild";
const PAYMENTS = { teamId: "team-payments", teamName: "Payments" };
const NEW_TEAM_NAME = `E2E Team ${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

type MeTeam = { teamId: string; teamName: string };

// The Team page's list comes from /api/litellm/me. `extra` lets a test add the
// team it just created, so the refetch after creation lists it as the app does.
async function stubMe(page: Page, extra: () => MeTeam | null = () => null) {
  await page.route(/\/api\/litellm\/me(\?|$)/, (route) => {
    const created = extra();
    const teams = [PAYMENTS, ...(created ? [created] : [])].map((t) => ({
      ...t,
      linked: false,
      configurable: true,
    }));
    return route.fulfill({
      json: { data: { linked: false, enabledOperations: [], teams } },
    });
  });
}

const newTeamButton = (page: Page) =>
  page.getByRole("button", { name: "New team" });

async function openTeamPage(page: Page) {
  await page.goto(`/dashboard/manage/team?team=${PAYMENTS.teamId}`);
  await waitForHydration(page);
  // The page-header picker precedes the Members region's own "Team" select.
  await expect(
    page.getByRole("combobox", { name: "Team", exact: true }).first(),
  ).toBeVisible();
}

test.describe("New team (unit M2, D5, D6)", () => {
  for (const role of ["internal-admin", "internal-org-admin"]) {
    test(`${role} opens the dialog, sees the fields and Cancel closes it`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      await stubMe(page);
      await openTeamPage(page);

      await newTeamButton(page).click();
      const dialog = page.getByRole("dialog", { name: "New team" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("textbox", { name: "Team name" }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("combobox", { name: "Department" }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Create team" }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
    });
  }

  test("a duplicate name shows the inline error: the seeded created team's name, any case", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await stubMe(page);
    await openTeamPage(page);

    await newTeamButton(page).click();
    const dialog = page.getByRole("dialog", { name: "New team" });
    await dialog
      .getByRole("textbox", { name: "Team name" })
      .fill(SEEDED_TEAM.toUpperCase());
    await dialog
      .getByRole("combobox", { name: "Department" })
      .selectOption({ label: "Engineering" });
    await dialog.getByRole("button", { name: "Create team" }).click();
    await expect(
      dialog.getByText("A team with this name already exists"),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("a registry team's name is a duplicate too (T-MI3)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await stubMe(page);
    await openTeamPage(page);

    await newTeamButton(page).click();
    const dialog = page.getByRole("dialog", { name: "New team" });
    await dialog.getByRole("textbox", { name: "Team name" }).fill("Payments");
    await dialog
      .getByRole("combobox", { name: "Department" })
      .selectOption({ label: "Engineering" });
    await dialog.getByRole("button", { name: "Create team" }).click();
    await expect(
      dialog.getByText("A team with this name already exists"),
    ).toBeVisible();
  });

  test("a unique name creates the team, closes the dialog and selects the new team (D6)", async ({
    page,
    context,
  }) => {
    let created: MeTeam | null = null;
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await stubMe(page, () => created);
    // The create call reaches the real route; the response is read on its way
    // through so the next /api/litellm/me lists the team deterministically.
    await page.route(/\/api\/teams(\?|$)/, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const response = await route.fetch();
      const body: unknown = await response.json();
      const data = (body as { data?: { teamId?: string; name?: string } }).data;
      if (response.status() === 201 && data?.teamId && data.name) {
        created = { teamId: data.teamId, teamName: data.name };
      }
      return route.fulfill({ response });
    });
    await openTeamPage(page);

    await newTeamButton(page).click();
    const dialog = page.getByRole("dialog", { name: "New team" });
    await dialog
      .getByRole("textbox", { name: "Team name" })
      .fill(NEW_TEAM_NAME);
    await dialog
      .getByRole("combobox", { name: "Department" })
      .selectOption({ label: "Engineering" });
    await dialog.getByRole("button", { name: "Create team" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]team=appteam-[0-9a-f-]+(&|$)/);
    const select = page
      .getByRole("combobox", { name: "Team", exact: true })
      .first();
    await expect(select).toHaveValue(/^appteam-/);
    await expect(
      select.getByRole("option", { name: NEW_TEAM_NAME }),
    ).toBeAttached();
    await expect(
      page.getByText("This team has no LiteLLM team of its own."),
    ).toBeVisible();
  });

  // Review m2-r1 U-B2: Rule 40.6 -- axe (WCAG 2 A/AA, serious or critical) and
  // no horizontal scroll, dialog open and with the duplicate-name error.
  for (const width of [375, 1440]) {
    test(`the New team dialog is axe-clean with no horizontal scroll at ${width}px, open and with the duplicate-name error (U-B2)`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await stubMe(page);
      await page.setViewportSize({ width, height: 900 });
      await openTeamPage(page);

      const check = async (label: string) => {
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          overflow.scrollWidth,
          `${label} overflows horizontally at ${width}px`,
        ).toBeLessThanOrEqual(overflow.clientWidth);
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
          label,
        ).toEqual([]);
      };

      await newTeamButton(page).click();
      const dialog = page.getByRole("dialog", { name: "New team" });
      await expect(dialog).toBeVisible();
      await check("dialog open");

      await dialog
        .getByRole("textbox", { name: "Team name" })
        .fill(SEEDED_TEAM);
      await dialog
        .getByRole("combobox", { name: "Department" })
        .selectOption({ label: "Engineering" });
      await dialog.getByRole("button", { name: "Create team" }).click();
      await expect(
        dialog.getByText("A team with this name already exists"),
      ).toBeVisible();
      await check("duplicate-name error");
    });
  }

  test("an auditor does not get the New team button (D5)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await stubMe(page);
    await openTeamPage(page);
    await expect(newTeamButton(page)).toHaveCount(0);
  });
});

test.describe("Cost by team and a team without an AWS account (App Teams spec)", () => {
  test("the seeded created team is not a row on Cost by team, with or without cost", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    // Pages mount the combined LiteLLM sections; answer the hidden head so the
    // spec does not depend on a LiteLLM connection (L6; responsive.spec.ts).
    await context.route(/\/api\/litellm\/combined\//, (route) =>
      route.fulfill({
        json: {
          data: {
            visibility: "hidden",
            configured: true,
            gatewayConfigured: false,
          },
        },
      }),
    );
    await page.goto("/dashboard/teams");
    await waitForHydration(page);

    await expect(
      page.getByText("Payments", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(SEEDED_TEAM)).toHaveCount(0);
  });
});
