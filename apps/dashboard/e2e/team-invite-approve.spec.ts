import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Access Control - "Placing a person by hand" (unit INV2: Invite
// { emailOrUpn }, Add to team { oid }, Approve and add through the accept
// route with a required reason; the states reach member writers only, T-IV5);
// Design System - Members panel ("Placing a person by hand": each action
// opens a confirm dialog naming the person and the team, Cancel focused
// first; readers see no state and no action) and Management -> Users (the
// same actions on the People table and the "Not signed in yet" panel, Add to
// team through a team picker); review sheet: one click-through per role that
// has an action, one case for a role without it, axe and 375 px with each
// dialog open. Component cases hold the detail (MembersPanel.test.tsx,
// TeamPickerDialog.test.tsx, UsersPeoplePanel.test.tsx, PendingLinksList.test.tsx;
// Rule 60.24a); this covers the real shell once per role. Why mocked: the
// harness has no signed-in-but-unplaced identity or pending invite for the
// forged session to place, and the LiteLLM API is fulfilled from fixtures
// (Rule 60.24), so the member read, the writes and the candidates are
// fulfilled here. Each Playwright test gets its own browser context, so each
// role starts clean. The Lead in scope needs the role-probe project's stored
// admin scope, so its journey is in role-landing.spec.ts (INV2 describe).
const TEAM_ID = "team-payments";
const TEAM_URL = `/dashboard/manage/team/${TEAM_ID}`;
const USERS_URL = "/dashboard/manage/users";
const OPS = ["addTeamMember", "removeTeamMember"];
const IVY_KEY = "ivy@example.test";

const ORG_UNITS = {
  departments: [{ id: "dept-engineering", name: "Engineering" }],
  teams: [
    { id: TEAM_ID, name: "Payments", departmentId: "dept-engineering" },
    { id: "team-ledger", name: "Ledger", departmentId: "dept-engineering" },
  ],
};

type Written = { path: string; body: unknown };

// writer: the member-writing roles get `state` and `candidates`; a reader's
// response carries neither (T-IV5).
async function mockTeamPage(page: Page, writer: boolean) {
  const written: Written[] = [];
  let sam = false;
  let ivy = false;
  const extra = <T extends Record<string, unknown>>(o: T) => (writer ? o : {});
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/litellm\//, (route) => {
    const url = new URL(route.request().url());
    const key = `${route.request().method()} ${url.pathname}`;
    const ok = (data: unknown) => route.fulfill({ json: { data } });
    const base = { spend: 5, maxBudget: 10, rpmLimit: null, tpmLimit: null };
    switch (key) {
      case "GET /api/litellm/me":
        return ok({
          linked: false,
          enabledOperations: OPS,
          teams: [
            {
              teamId: TEAM_ID,
              teamName: "Payments",
              linked: true,
              configurable: true,
            },
          ],
        });
      case `GET /api/litellm/teams/${TEAM_ID}`:
        return ok({
          connected: true,
          spendSource: "litellm-team",
          team: {
            alias: "Payments",
            spend: 10,
            maxBudget: 500,
            softBudget: null,
            budgetDuration: "30d",
            models: ["claude-sonnet"],
            rpmLimit: null,
            tpmLimit: null,
          },
          daily: [{ date: "2026-11-14", spend: 10 }],
          enabledOperations: OPS,
        });
      case `GET /api/litellm/teams/${TEAM_ID}/members`:
        return ok({
          connected: true,
          ...extra({ candidates: [] }),
          items: [
            {
              ...base,
              userId: "u-ada",
              oid: "oid-ada",
              name: "Ada Lovelace",
              email: "ada@example.test",
            },
            {
              ...base,
              userId: "u-ext1",
              email: "ext1@example.test",
              ...extra({ state: "unknown" }),
            },
            sam
              ? {
                  ...base,
                  userId: "u-sam",
                  oid: "oid-sam",
                  name: "Sam Rowe",
                  email: "sam@example.test",
                }
              : {
                  ...base,
                  userId: "u-sam",
                  email: "sam@example.test",
                  ...extra({
                    state: "signed-in",
                    identityOid: "oid-sam",
                    identityName: "Sam Rowe",
                    identityEmail: "sam.rowe@corp.example.test",
                  }),
                },
            ivy
              ? {
                  ...base,
                  userId: "u-ivy",
                  oid: "oid-ivy",
                  name: "Ivy Chen",
                  email: IVY_KEY,
                }
              : {
                  ...base,
                  userId: "u-ivy",
                  email: IVY_KEY,
                  ...extra({ state: "invited" }),
                },
          ],
        });
      case `GET /api/litellm/teams/${TEAM_ID}/keys`:
        return ok({ connected: true, items: [] });
      default:
        return route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "not found" } },
        });
    }
  });
  await page.route(new RegExp(`/api/teams/${TEAM_ID}/members$`), (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { oid?: string };
    written.push({ path: "members", body });
    if (body.oid === "oid-sam") sam = true;
    return route.fulfill({ status: 201, json: { data: { ok: true } } });
  });
  await page.route(/\/members\/pending\/ivy(%40|@)example\.test\//, (route) => {
    if (route.request().method() === "POST") {
      written.push({ path: "accept", body: route.request().postDataJSON() });
      ivy = true;
      return route.fulfill({
        json: { data: { oid: "oid-ivy", teamId: TEAM_ID } },
      });
    }
    return route.fulfill({
      json: {
        data: {
          items: [
            {
              oid: "oid-ivy",
              displayName: "Ivy Chen",
              upn: IVY_KEY,
              email: IVY_KEY,
              exact: true,
              signal: "upn",
            },
          ],
        },
      },
    });
  });
  return written;
}

async function mockUsersPage(page: Page, writer: boolean) {
  const written: Written[] = [];
  let samTeam: string | null = null;
  const row = (o: Record<string, unknown>) => ({
    authMethod: "entra",
    memberTeamId: null,
    litellm: { state: "none" },
    linkVersion: 0,
    match: null,
    ...o,
  });
  await page.route(/\/api\/identities\/directory/, (route) =>
    route.fulfill({
      json: {
        data: {
          items: [
            row({
              oid: "oid-sam",
              displayName: "Sam Rowe",
              email: "sam@example.test",
              memberTeamId: samTeam,
              ...(writer && samTeam === null ? { state: "signed-in" } : {}),
            }),
            row({
              oid: "oid-ivy",
              displayName: "Ivy Chen",
              email: IVY_KEY,
              ...(writer
                ? {
                    state: "invited",
                    invites: [{ teamId: TEAM_ID, key: IVY_KEY }],
                  }
                : {}),
            }),
          ],
        },
      },
    }),
  );
  await page.route(/\/api\/identities\/pending-links/, (route) =>
    route.fulfill({
      json: {
        data: {
          items: [
            {
              email: "waiting@example.test",
              litellmUserId: "lu-wait",
              version: 1,
              createdAt: "2026-11-20T10:00:00.000Z",
            },
          ],
        },
      },
    }),
  );
  await page.route(/\/api\/access\/org-units/, (route) =>
    route.fulfill({ json: { data: ORG_UNITS } }),
  );
  await page.route(/\/api\/teams\/[^/]+\/members$/, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { oid?: string };
    written.push({
      path: new URL(route.request().url()).pathname,
      body,
    });
    if (body.oid === "oid-sam") samTeam = "team-ledger";
    return route.fulfill({ status: 201, json: { data: { ok: true } } });
  });
  await page.route(/\/members\/pending\/ivy(%40|@)example\.test\//, (route) =>
    route.fulfill({
      json: {
        data: {
          items: [
            {
              oid: "oid-ivy",
              displayName: "Ivy Chen",
              upn: IVY_KEY,
              email: IVY_KEY,
              exact: true,
              signal: "upn",
            },
          ],
        },
      },
    }),
  );
  return written;
}

// Project standard (accessibility.spec.ts): WCAG 2 A/AA, serious or critical;
// no horizontal overflow of the page or of an open dialog (Rule 40.6).
async function expectClean(page: Page) {
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
  const overflow = await page.evaluate(() => ({
    page:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    dialogs: [...document.querySelectorAll("[role=dialog],[role=alertdialog]")]
      .map((el) => el.scrollWidth - el.clientWidth)
      .filter((d) => d > 0),
  }));
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.dialogs).toEqual([]);
}

const ACTION = /^(invite|add .* to team|approve and add)/i;

for (const role of ["internal-admin", "internal-org-admin"] as const) {
  test.describe(`${role}: placing a person by hand (INV2)`, () => {
    test.beforeEach(async ({ context }) => {
      await signInAsTestUser(context, { roles: [role] });
    });

    test("Team page: Invite, Add to team and Approve and add each send their write and show the result", async ({
      page,
    }) => {
      const written = await mockTeamPage(page, true);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(TEAM_URL);
      await waitForHydration(page);
      const panel = page.getByRole("region", { name: "LiteLLM members" });

      await panel
        .getByRole("button", { name: "Invite ext1@example.test" })
        .click();
      const invite = page.getByRole("alertdialog");
      await expect(invite).toContainText("ext1@example.test");
      await expect(invite).toContainText("Payments");
      await expect(
        invite.getByRole("button", { name: "Cancel" }),
      ).toBeFocused();
      expect(written).toEqual([]);
      await invite.getByRole("button", { name: "Confirm" }).click();
      await expect(invite).toBeHidden();
      expect(written).toEqual([
        { path: "members", body: { emailOrUpn: "ext1@example.test" } },
      ]);

      await panel
        .getByRole("button", { name: "Add sam@example.test to team" })
        .click();
      const add = page.getByRole("alertdialog");
      await expect(add).toContainText("sam@example.test");
      // Review B1 (Access Control - Same person): the confirm names the
      // identity and says the LiteLLM email is not verified (T-IV2).
      await expect(add).toContainText("Sam Rowe");
      await expect(add).toContainText("sam.rowe@corp.example.test");
      await expect(add).toContainText(/not verified/i);
      await expect(add.getByRole("button", { name: "Cancel" })).toBeFocused();
      await add.getByRole("button", { name: "Confirm" }).click();
      await expect(
        panel.getByRole("button", { name: "Remove Sam Rowe" }),
      ).toBeVisible();
      expect(written[1]).toEqual({
        path: "members",
        body: { oid: "oid-sam" },
      });

      await panel
        .getByRole("button", { name: `Approve and add ${IVY_KEY}` })
        .click();
      const accept = page.getByRole("dialog", { name: /approve and add/i });
      await expect(
        accept.getByRole("radio", { name: /Ivy Chen/ }),
      ).toBeChecked();
      await accept.getByLabel(/reason/i).fill("Same person");
      await accept.getByRole("button", { name: "Confirm" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Add to team" })
        .click();
      await expect(
        panel.getByRole("button", { name: "Remove Ivy Chen" }),
      ).toBeVisible();
      expect(written[2]).toEqual({
        path: "accept",
        body: { oid: "oid-ivy", reason: "Same person" },
      });
    });

    test("Users page: Add to team through the picker, Approve and add on a person, Invite from Not signed in yet", async ({
      page,
    }) => {
      const written = await mockUsersPage(page, true);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(USERS_URL);
      await waitForHydration(page);
      const people = page.getByRole("region", { name: "People" });

      await people
        .getByRole("button", { name: "Add Sam Rowe to team" })
        .click();
      const picker = page.getByRole("dialog");
      await picker.getByRole("combobox", { name: "Team" }).selectOption({
        label: "Ledger",
      });
      await picker.getByRole("button", { name: "Continue" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toContainText("Sam Rowe");
      await expect(confirm).toContainText("Ledger");
      await confirm.getByRole("button", { name: "Confirm" }).click();
      await expect(
        people.getByRole("button", { name: "Add Sam Rowe to team" }),
      ).toHaveCount(0);
      expect(written).toEqual([
        { path: "/api/teams/team-ledger/members", body: { oid: "oid-sam" } },
      ]);

      await people
        .getByRole("button", { name: "Approve and add Ivy Chen (Payments)" })
        .click();
      await expect(
        page
          .getByRole("dialog", { name: /approve and add/i })
          .getByRole("radio", { name: /Ivy Chen/ }),
      ).toBeChecked();
      await page.keyboard.press("Escape");

      const waiting = page.getByRole("region", { name: "Not signed in yet" });
      await waiting
        .getByRole("button", { name: "Invite waiting@example.test" })
        .click();
      const invitePicker = page.getByRole("dialog");
      await invitePicker
        .getByRole("combobox", { name: "Team" })
        .selectOption({ label: "Payments" });
      await invitePicker.getByRole("button", { name: "Continue" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Confirm" })
        .click();
      await expect.poll(() => written.length).toBe(2);
      expect(written[1]).toEqual({
        path: `/api/teams/${TEAM_ID}/members`,
        body: { emailOrUpn: "waiting@example.test" },
      });
    });
  });
}

test.describe("internal-auditor: a reader sees no placement action (T-IV5)", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
  });

  test("the Team page and the Users page list the people with no Invite, Add to team or Approve and add", async ({
    page,
  }) => {
    await mockTeamPage(page, false);
    await mockUsersPage(page, false);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(TEAM_URL);
    await waitForHydration(page);
    await expect(
      page
        .getByRole("region", { name: "LiteLLM members" })
        .getByRole("row", { name: /ext1@example\.test/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: ACTION })).toHaveCount(0);

    await page.goto(USERS_URL);
    await waitForHydration(page);
    await expect(page.getByText("Sam Rowe")).toBeVisible();
    await expect(page.getByText("waiting@example.test")).toBeVisible();
    await expect(page.getByRole("button", { name: ACTION })).toHaveCount(0);
  });
});

// Review sheet section 3: axe and one 375 px check with each new dialog open.
test.describe("dialogs open at 375px (INV2): no serious or critical axe violation, no overflow", () => {
  test.beforeEach(async ({ context, page }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await page.setViewportSize({ width: 375, height: 800 });
  });

  test("Team page: the confirm dialog and the Approve and add dialog", async ({
    page,
  }) => {
    await mockTeamPage(page, true);
    await page.goto(TEAM_URL);
    await waitForHydration(page);
    const panel = page.getByRole("region", { name: "LiteLLM members" });

    await panel
      .getByRole("button", { name: "Invite ext1@example.test" })
      .click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expectClean(page);
    await page.getByRole("button", { name: "Cancel" }).click();

    await panel
      .getByRole("button", { name: `Approve and add ${IVY_KEY}` })
      .click();
    const accept = page.getByRole("dialog", { name: /approve and add/i });
    await expect(accept.getByRole("radio", { name: /Ivy Chen/ })).toBeVisible();
    await accept.getByLabel(/reason/i).fill("Same person");
    await expectClean(page);
    await accept.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expectClean(page);
  });

  test("Users page: the team picker and its confirmation", async ({ page }) => {
    await mockUsersPage(page, true);
    await page.goto(USERS_URL);
    await waitForHydration(page);

    await page
      .getByRole("button", { name: "Add Sam Rowe to team" })
      .first()
      .click();
    const picker = page.getByRole("dialog");
    await expect(picker.getByRole("combobox", { name: "Team" })).toBeVisible();
    await expectClean(page);
    await picker
      .getByRole("combobox", { name: "Team" })
      .selectOption({ label: "Ledger" });
    await picker.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expectClean(page);
  });
});
