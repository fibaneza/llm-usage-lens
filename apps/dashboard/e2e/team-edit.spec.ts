import { expect, type Page, test } from "@playwright/test";

import { expectNoBlockingViolations } from "./support/axe";
import { E2E_BASE_URL } from "./support/constants";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System - Team page, round 3 (unit TP1): Summary (T-TP1:
// name, department, kind, lead names, member count, LiteLLM team, budget
// resets) and Edit team (T-TP7: the button for internal-admin and
// internal-org-admin on a created team; a registry team says "Edited in
// Settings -> AWS accounts"; a click for admin and org-admin; axe with the
// dialog open and with a FieldHelp popover open at 375px and desktop; the
// stale-version path, T-TP3); Access Control - Edit a created team (the
// version the caller was shown; 409 when stale). The route's role table, 400
// and 404 cases run once in the route-contract suite and the route's own file
// (Rule 60.24a); the lead's journey is in team-edit-role-landing.spec.ts (the
// probe identities). The harness has no LiteLLM team (the fake gateway lists
// none), so the id and alias shown to a global role are proved in
// TeamSummaryPanel.test.tsx and the page test; here the unlinked state
// is read as admin. Each test creates its own team through the real route
// with a name unique to the run, so the seeded team names other specs use are
// never renamed; created teams are not cleaned up (the gate's fresh seed
// resets them), as in team-create.spec.ts. Only one department is seeded, so
// moving a team is covered by the route's integration test.
const DEPARTMENT_ID = "dept-engineering";
const REGISTRY_TEAM = { teamId: "team-payments", name: "Payments" };
const SEEDED_CREATED = {
  teamId: "appteam-00000000-0000-4000-8000-000000000001",
  name: "Platform Guild",
};
// Writes carry a same-origin Origin (Access Control - Enforcement item 6;
// T-TP7): a bare request from the test client is refused with 403.
const SAME_ORIGIN = { origin: E2E_BASE_URL };
const run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

type Created = { teamId: string; name: string; version: number };

async function createTeam(page: Page, name: string): Promise<Created> {
  const response = await page.request.post("/api/teams", {
    headers: SAME_ORIGIN,
    data: { name, departmentId: DEPARTMENT_ID },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { data: Created };
  return body.data;
}

// The Team page reads /api/litellm/me in the browser (the harness has no
// LiteLLM team): answer it with this team, unlinked.
async function stubMe(page: Page, team: { teamId: string; name: string }) {
  await page.route(/\/api\/litellm\/me(\?|$)/, (route) =>
    route.fulfill({
      json: {
        data: {
          linked: false,
          enabledOperations: [],
          teams: [
            {
              teamId: team.teamId,
              teamName: team.name,
              linked: false,
              configurable: false,
            },
          ],
        },
      },
    }),
  );
}

async function openTeam(page: Page, team: { teamId: string; name: string }) {
  await stubMe(page, team);
  await page.goto(`/dashboard/manage/team/${team.teamId}`);
  await waitForHydration(page);
  await expect(page.getByRole("region", { name: "Summary" })).toBeVisible();
}

const editButton = (page: Page) =>
  page.getByRole("button", { name: "Edit team" });

test.describe("Team summary (T-TP1)", () => {
  test("an admin reads the name, department, kind, members and LiteLLM state of a team from an AWS account", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await openTeam(page, REGISTRY_TEAM);
    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary).toContainText(REGISTRY_TEAM.name);
    await expect(summary).toContainText("Engineering");
    await expect(summary).toContainText("From an AWS account");
    await expect(summary).toContainText("Not linked");
    await expect(summary).toContainText("Edited in Settings → AWS accounts");
    await expect(editButton(page)).toHaveCount(0);
  });

  test("a created team reads 'Created here' with Edit team for an admin", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    const team = await createTeam(page, `E2E Summary ${run}`);
    await openTeam(page, team);
    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary).toContainText(team.name);
    await expect(summary).toContainText("Created here");
    await expect(summary).not.toContainText("Edited in Settings");
    await expect(editButton(page)).toBeVisible();
  });
});

test.describe("Edit team (T-TP7)", () => {
  for (const role of ["internal-admin", "internal-org-admin"]) {
    test(`${role} clicks Edit team, renames the team, saves and sees the new name`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      const team = await createTeam(page, `E2E Edit ${role} ${run}`);
      await openTeam(page, team);

      await editButton(page).click();
      const dialog = page.getByRole("dialog", { name: "Edit team" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("textbox", { name: "Team name" }),
      ).toHaveValue(team.name);
      const renamed = `${team.name} renamed`;
      await dialog.getByRole("textbox", { name: "Team name" }).fill(renamed);
      await dialog.getByRole("button", { name: "Save" }).click();

      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Summary" })).toContainText(
        renamed,
      );
    });
  }

  test("a name another team has shows the creation error and keeps the dialog open (T-TP3)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    const team = await createTeam(page, `E2E Taken ${run}`);
    await openTeam(page, team);
    await editButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Edit team" });
    await dialog
      .getByRole("textbox", { name: "Team name" })
      .fill(REGISTRY_TEAM.name);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(
      dialog.getByText("A team with this name already exists"),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("a stale version says the team changed and reloads the other person's name (T-TP3)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    const team = await createTeam(page, `E2E Stale ${run}`);
    await openTeam(page, team);
    await editButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Edit team" });
    await dialog
      .getByRole("textbox", { name: "Team name" })
      .fill(`${team.name} mine`);

    // A second person saves first, through the same route, with the version
    // this page also holds.
    const other = await page.request.patch(`/api/teams/${team.teamId}`, {
      headers: SAME_ORIGIN,
      data: {
        name: `${team.name} theirs`,
        departmentId: DEPARTMENT_ID,
        version: team.version,
      },
    });
    expect(other.status()).toBe(200);

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toContainText(/team changed/i);
    // Access Control - Edit a created team ("a stale one is 409"); Design
    // System - Team page, round 3, T-TP3. The open modal hides the page behind
    // it from the accessibility tree, so close it as a user would, then read
    // the summary the 409 refreshed.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("region", { name: "Summary" })).toContainText(
      `${team.name} theirs`,
    );
  });

  // The seeded created team is only read, never renamed, so it needs no
  // second sign-in in one context.
  test("the auditor sees the summary of a created team and no Edit team button", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await openTeam(page, SEEDED_CREATED);
    await expect(page.getByRole("region", { name: "Summary" })).toContainText(
      SEEDED_CREATED.name,
    );
    await expect(page.getByRole("region", { name: "Summary" })).toContainText(
      "Created here",
    );
    await expect(editButton(page)).toHaveCount(0);
  });

  for (const width of [375, 1440]) {
    test(`axe is clean and nothing scrolls sideways at ${width}px with the Edit team dialog open and with a FieldHelp popover open`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await page.setViewportSize({ width, height: 900 });
      const team = await createTeam(page, `E2E Axe ${width} ${run}`);
      await openTeam(page, team);

      const noOverflow = async (label: string) => {
        const size = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          size.scrollWidth,
          `${label} overflows at ${width}px`,
        ).toBeLessThanOrEqual(size.clientWidth);
      };

      // One FieldHelp popover open on the page itself (T-TP6): Members, in the
      // access section the admin sees.
      await page.getByRole("button", { name: "About Members" }).click();
      await expect(
        page.getByText(
          "The people in this team. A person is in one team at most.",
        ),
      ).toBeVisible();
      await noOverflow("FieldHelp popover");
      await expectNoBlockingViolations(page);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "About Members" }),
      ).toBeFocused();

      await editButton(page).click();
      await expect(
        page.getByRole("dialog", { name: "Edit team" }),
      ).toBeVisible();
      await noOverflow("Edit team dialog");
      await expectNoBlockingViolations(page);
    });
  }
});
