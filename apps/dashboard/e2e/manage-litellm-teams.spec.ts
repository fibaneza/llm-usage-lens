import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System -- Management improvements, D2 (Management -> LiteLLM
// -> LiteLLM teams at /dashboard/manage/litellm/teams; New LiteLLM team for
// internal-admin only; read-only for the auditor) and D4a (both ids from
// searchable comboboxes, linked ones "linked" and not selectable, no free-text
// id field, an unreadable LiteLLM list says so, keyboard operable); LiteLLM
// spec LD24 (admin and org-admin link teams), MI-D4a, LT-MI3; App Teams spec --
// UI (spend source table). Moved here from settings-litellm.spec.ts (the Team
// links tab left Settings in M1). Detail (filtering, disabled options, request
// bodies, error text) lives in the component tests (Rule 60.24a); this covers
// the real shell, role gating, the keyboard path and axe. The API is fulfilled
// from fixtures (Rule 60.24).
const URL_TEAMS = "/dashboard/manage/litellm/teams";

const LINKS = [
  {
    teamId: "payments",
    litellmTeamId: "ll-111",
    version: 1,
    updatedAt: "2026-11-01T00:00:00Z",
  },
];
const APP_TEAMS = [
  { teamId: "payments", teamName: "Payments", spendSource: "litellm-team" },
  { teamId: "growth", teamName: "Growth", spendSource: "member-sum" },
];
const ORG_UNITS = {
  teams: [
    { id: "growth", name: "Growth", departmentId: "eng" },
    { id: "payments", name: "Payments", departmentId: "eng" },
  ],
  departments: [{ id: "eng", name: "Engineering" }],
};
const LITELLM_TEAMS = [
  { litellmTeamId: "ll-111", alias: "Alpha" },
  { litellmTeamId: "ll-222", alias: "Beta" },
];

async function mockApi(
  page: Page,
  links: Record<string, unknown> = {
    configured: true,
    litellmTeams: LITELLM_TEAMS,
  },
) {
  const writes: { method: string; path: string; body: unknown }[] = [];
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/accounts(\?|$)/, (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route(/\/api\/access\/org-units(\?|$)/, (route) =>
    route.fulfill({ json: { data: ORG_UNITS } }),
  );
  await page.route(/\/api\/litellm\/toggles$/, (route) =>
    route.fulfill({
      json: {
        data: { version: 0, edition: "oss", ssoEnabled: false, operations: {} },
      },
    }),
  );
  await page.route(/\/api\/litellm\/team-links(\?|$)/, (route) =>
    route.fulfill({
      json: { data: { items: LINKS, appTeams: APP_TEAMS, ...links } },
    }),
  );
  await page.route(/\/api\/litellm\/team-links\/[^/?]+$/, (route) => {
    const request = route.request();
    writes.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postDataJSON(),
    });
    return route.fulfill({
      json: {
        data: {
          teamId: "growth",
          litellmTeamId: "ll-222",
          version: 1,
          updatedAt: "2026-11-02T00:00:00Z",
        },
      },
    });
  });
  return writes;
}

async function open(page: Page) {
  await page.goto(URL_TEAMS);
  await waitForHydration(page);
  await expect(page.getByText("ll-111").first()).toBeVisible();
}

const teamPicker = (page: Page) =>
  page.getByRole("combobox", { name: "Team", exact: true });
const litellmPicker = (page: Page) =>
  page.getByRole("combobox", { name: "LiteLLM team", exact: true });

test.describe("Management -> LiteLLM -> LiteLLM teams: link form (D4a, LT-MI3)", () => {
  test("an admin links a team by keyboard from the two lists; linked options are disabled; no id is typed", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    const writes = await mockApi(page);
    await open(page);
    // New LiteLLM team (internal-admin only): the alias is the only typed value.
    await expect(
      page.getByRole("form", { name: "New LiteLLM team" }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(1);
    await expect(
      page.getByRole("textbox", { name: "LiteLLM team alias" }),
    ).toBeVisible();

    await teamPicker(page).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("option", { name: /Payments/ }),
    ).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.type("grow");
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(teamPicker(page)).toContainText("Growth");
    await expect(teamPicker(page)).toBeFocused();

    await litellmPicker(page).click();
    await expect(page.getByRole("option", { name: /Alpha/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(litellmPicker(page)).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Link", exact: true }),
    ).toBeDisabled();

    await litellmPicker(page).click();
    await page.getByRole("option", { name: /Beta/ }).click();
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      method: "PUT",
      path: "/api/litellm/team-links/growth",
      body: { litellmTeamId: "ll-222", version: null },
    });
  });

  test("an unreadable LiteLLM team list says so and leaves no LiteLLM picker or typed fallback", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page, { configured: true, litellmTeamsUnavailable: true });
    await open(page);
    await expect(
      page.getByText("LiteLLM teams could not be loaded"),
    ).toBeVisible();
    await expect(litellmPicker(page)).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
  });
});

test.describe("Management -> LiteLLM -> LiteLLM teams: roles (LD24)", () => {
  test("an org-admin links teams (list and Unlink) but has no New LiteLLM team", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await open(page);
    await expect(teamPicker(page)).toBeVisible();
    await expect(
      page.getByRole("form", { name: "New LiteLLM team" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Unlink payments" }),
    ).toBeVisible();
  });

  test("an auditor reads the list and spend sources but sees no picker, Link, Unlink or New LiteLLM team", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page);
    await open(page);
    await expect(
      page.getByRole("table", { name: "Spend source by app team" }),
    ).toBeVisible();
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^unlink/i })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Link", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("form", { name: "New LiteLLM team" }),
    ).toHaveCount(0);
  });
});

test.describe("Management -> LiteLLM -> LiteLLM teams: spend source and accessibility", () => {
  test("spend source lists linked teams only (D-LF3); picker still offers the rest; axe-clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await open(page);
    const table = page.getByRole("table", { name: "Spend source by app team" });
    await expect(
      table
        .getByRole("row", { name: /Payments/ })
        .getByRole("cell", { name: "LiteLLM team" }),
    ).toBeVisible();
    await expect(table.getByRole("row", { name: /Growth/ })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Members of Alpha" }),
    ).toBeVisible();

    await teamPicker(page).click();
    await expect(page.getByRole("option", { name: /Growth/ })).toBeVisible();
    await expect(page).toHaveTitle(/\S/);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => v.id),
    ).toEqual([]);
  });

  // LF1 UI review WARN 3 (Design System - Layout, Rule 40.6; D4a): the team
  // picker open on the LiteLLM teams tab at both ends of the breakpoint range.
  test("with the Team picker open the tab has no serious axe violation at 375 and no horizontal scroll at 1440", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    const noScroll = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page);
    await teamPicker(page).click();
    await expect(page.getByRole("option", { name: /Growth/ })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => v.id),
    ).toEqual([]);
    await page.keyboard.press("Escape");
    expect(await noScroll()).toBe(true);

    await page.setViewportSize({ width: 1440, height: 900 });
    await teamPicker(page).click();
    await expect(page.getByRole("option", { name: /Growth/ })).toBeVisible();
    expect(await noScroll()).toBe(true);
  });
});

// Design System - "Sorting in the other tables (unit SRT1, 2026-11-24;
// D-SR1)": the LiteLLM teams table sorts by the LiteLLM team column in the
// browser; the sort lives in the URL, so a real reload keeps it.
test.describe("Management -> LiteLLM -> LiteLLM teams: sorting (unit SRT1; D-SR1)", () => {
  test("the LiteLLM team header sorts the table, the URL keeps it across a reload", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page, {
      configured: true,
      litellmTeams: [
        { litellmTeamId: "ll-222", alias: "Beta" },
        { litellmTeamId: "ll-111", alias: "Alpha" },
      ],
    });
    await open(page);
    const table = page.getByRole("table", { name: "LiteLLM teams" });
    const header = table.getByRole("columnheader", { name: "LiteLLM team" });
    const aliases = () =>
      table.getByRole("row").filter({ has: page.getByRole("cell") });
    await expect(aliases().first()).toContainText("Beta");
    await header.getByRole("button").click();
    await expect(page).toHaveURL(/sort=team/);
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(aliases().first()).toContainText("Alpha");
    await page.reload();
    await waitForHydration(page);
    await expect(
      page
        .getByRole("table", { name: "LiteLLM teams" })
        .getByRole("columnheader", { name: "LiteLLM team" }),
    ).toHaveAttribute("aria-sort", "ascending");
  });
});

// Design System - LiteLLM teams tab, round 3 (unit LP1, D-R3-5, T-LP1, T-LP5):
// "Search teams" is a SearchInput (visible label, magnifier) that filters the
// team links and the LiteLLM teams table in the browser by name, alias and id;
// "No matching teams" when nothing matches; each LiteLLM team's name links to
// its page. Detail (every filter field, the encoded href) is in the component
// test (Rule 60.24a); this proves it in the real shell.
test.describe("Management -> LiteLLM -> LiteLLM teams: Search teams and team links (LP1, T-LP1, T-LP5)", () => {
  test("the search has a visible label (the magnifier is the component test's), filters both tables by alias and id, and says 'No matching teams'", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page);
    await open(page);

    const box = page.getByRole("searchbox", { name: "Search teams" });
    await expect(page.getByLabel("Search teams")).toBeVisible();
    await expect(page.getByText("Search teams", { exact: true })).toBeVisible();

    const table = page.getByRole("table", { name: "LiteLLM teams" });
    await expect(table.getByRole("row")).toHaveCount(3);
    await box.fill("BETA");
    await expect(table.getByRole("link", { name: "Beta" })).toBeVisible();
    await expect(table.getByRole("link", { name: "Alpha" })).toHaveCount(0);
    await expect(page.getByText("ll-111")).toHaveCount(0);

    await box.fill("ll-111");
    await expect(table.getByRole("link", { name: "Alpha" })).toBeVisible();
    await expect(page.getByText("ll-111").first()).toBeVisible();

    await box.fill("zzz-none");
    await expect(page.getByText("No matching teams")).toHaveCount(2);
  });

  test("each LiteLLM team's name links to its page", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await open(page);
    await expect(
      page
        .getByRole("table", { name: "LiteLLM teams" })
        .getByRole("link", { name: "Alpha" }),
    ).toHaveAttribute("href", "/dashboard/manage/litellm/teams/ll-111");
  });
});
