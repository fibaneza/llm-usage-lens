import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System -- Management pages (the LiteLLM area, D2: route tabs
// Organisation / LiteLLM teams / LiteLLM users on the one Tabs component; the
// index goes to the first visible tab), Routes and redirects (D3: every old
// URL redirects on the server and keeps its query), Responsive (no horizontal
// scroll at 375; Rule 40.6); Access Control MI-D2 (admin, org-admin and
// auditor read-only see it; lead and user get the missing-page 404); LiteLLM
// spec LD24 (team links: admin and org-admin edit, auditor read-only; New
// LiteLLM team: admin only). Section behaviour lives in component tests
// (Rule 60.24a); the caller x route matrix in
// app/dashboard/__tests__/manage-routes.integration.test.ts. This file covers
// what only a browser shows: the real shell, route tabs, real redirects with
// their query, axe and no-overflow. The harness cannot forge a team-scope Lead,
// so internal-viewer stands for "no LiteLLM area" (lead and user share the
// 404). The LiteLLM API is fulfilled from fixtures (Rule 60.24).
const AREA = "/dashboard/manage/litellm";
const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-03";

async function mockApi(page: Page) {
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/access\/org-units(\?|$)/, (route) =>
    route.fulfill({
      json: {
        data: {
          teams: [{ id: "t1", name: "Payments", departmentId: "d1" }],
          departments: [{ id: "d1", name: "Engineering" }],
        },
      },
    }),
  );
  await page.route(/\/api\/litellm\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    const body: Record<string, unknown> = {
      "/api/litellm/org": {
        configured: true,
        totals: { spend: 321.75 },
        enabledOperations: [],
        daily: [{ date: "2026-11-14", spend: 100 }],
        litellmTeams: [
          {
            litellmTeamId: "ll-1",
            alias: "Payments LLM",
            spend: 321.75,
            maxBudget: 500,
            memberCount: 7,
            linkedAppTeam: { teamId: "t1", teamName: "Payments" },
          },
        ],
        appTeams: [
          {
            teamId: "t1",
            teamName: "Payments",
            spendSource: "litellm-team",
            spend: 321.75,
          },
        ],
      },
      "/api/litellm/team-links": {
        items: [
          {
            teamId: "t1",
            litellmTeamId: "ll-1",
            version: 1,
            updatedAt: "2026-11-01T00:00:00Z",
          },
        ],
        configured: true,
        litellmTeams: [
          { litellmTeamId: "ll-1", alias: "Payments LLM" },
          { litellmTeamId: "ll-2", alias: "Growth LLM" },
        ],
        appTeams: [
          {
            teamId: "t1",
            teamName: "Payments",
            spendSource: "litellm-team",
            spend: 321.75,
          },
        ],
      },
      "/api/litellm/toggles": { version: 0, edition: "oss", operations: {} },
      "/api/litellm/users": {
        page: 1,
        pageSize: 25,
        enabledOperations: [],
        hasMore: false,
        users: [
          {
            key: "oid-ada",
            linkState: "linked",
            appUser: {
              oid: "oid-ada",
              displayName: "Ada Lovelace",
              email: "ada@example.test",
              version: 1,
            },
            litellmUser: {
              userId: "u-ada",
              email: "ada@example.test",
              spend: 77.1,
              maxBudget: 150,
              teams: [{ teamId: "t1", teamName: "Payments" }],
            },
          },
        ],
      },
    };
    return path in body
      ? route.fulfill({ json: { data: body[path] } })
      : route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "not found" } },
        });
  });
}

const tabRow = (page: Page) =>
  page.getByRole("tablist", { name: "LiteLLM sections" });

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

test.describe("Management -> LiteLLM area (M1)", () => {
  for (const role of [
    "internal-admin",
    "internal-org-admin",
    "internal-auditor",
  ]) {
    test(`${role}: the index lands on Organisation; the three tabs are links and Back steps across them`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      await mockApi(page);
      await page.goto(AREA);
      await waitForHydration(page);

      await expect(page).toHaveURL(`${AREA}/organisation`);
      await expect(
        page.getByRole("heading", { level: 1, name: "LiteLLM" }),
      ).toBeVisible();
      const tabs = tabRow(page).getByRole("tab");
      expect((await tabs.allTextContents()).map((t) => t.trim())).toEqual([
        "Organisation",
        "LiteLLM teams",
        "LiteLLM users",
      ]);
      await expect(
        tabRow(page).getByRole("tab", { name: "Organisation" }),
      ).toHaveAttribute("aria-current", "page");
      await expect(
        page.getByRole("region", { name: "Organisation" }),
      ).toContainText("Payments");

      await tabRow(page).getByRole("tab", { name: "LiteLLM teams" }).click();
      await expect(page).toHaveURL(`${AREA}/teams`);
      await expect(
        tabRow(page).getByRole("tab", { name: "LiteLLM teams" }),
      ).toHaveAttribute("aria-current", "page");

      await tabRow(page).getByRole("tab", { name: "LiteLLM users" }).click();
      await expect(page).toHaveURL(`${AREA}/users`);
      // D16a: the tab is the users list with link states, search kept.
      await expect(
        page.getByRole("searchbox", { name: /search users/i }),
      ).toBeVisible();
      await expect(
        page.getByRole("row", { name: /Ada Lovelace/ }),
      ).toBeVisible();

      await page.goBack();
      await expect(page).toHaveURL(`${AREA}/teams`);
    });
  }

  // LD24 / D4: Link form for admin and org-admin; New LiteLLM team admin only.
  for (const [role, canLink, canCreate] of [
    ["internal-admin", true, true],
    ["internal-org-admin", true, false],
    ["internal-auditor", false, false],
  ] as const) {
    test(`${role}: LiteLLM teams ${canLink ? "offers" : "hides"} the link form and ${canCreate ? "offers" : "hides"} New LiteLLM team`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      await mockApi(page);
      await page.goto(`${AREA}/teams`);
      await waitForHydration(page);

      await expect(page.getByText("Search teams")).toBeVisible();
      await expect(page.getByRole("button", { name: /^unlink/i })).toHaveCount(
        canLink ? 1 : 0,
      );
      await expect(
        page.getByRole("heading", { name: "New LiteLLM team" }),
      ).toHaveCount(canCreate ? 1 : 0);
    });
  }

  test("a user (and so a lead) gets the 404 on the index, every tab and an unknown tab, with no LiteLLM request", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page);
    const hits: string[] = [];
    page.on("request", (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith("/api/litellm")) hits.push(path);
    });
    for (const path of [
      AREA,
      `${AREA}/organisation`,
      `${AREA}/teams`,
      `${AREA}/users`,
      `${AREA}/nope`,
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    expect(hits).toEqual([]);
  });

  // Review m2-r1 U-B1: Design System -- Management pages (Organisation view:
  // an app team without a LiteLLM-reported spend links to its Team usage page).
  for (const role of ["internal-admin", "internal-org-admin"]) {
    test(`${role}: "Open the team page" on Organisation lands on Team usage for that team (U-B1)`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      await mockApi(page);
      // Registered after mockApi, so these win over its catch-all.
      await page.route(/\/api\/litellm\/org(\?|$)/, (route) =>
        route.fulfill({
          json: {
            data: {
              configured: true,
              totals: { spend: 0 },
              enabledOperations: [],
              daily: [],
              litellmTeams: [],
              appTeams: [
                {
                  teamId: "team-payments",
                  teamName: "Payments",
                  spendSource: "member-sum",
                  spend: null,
                },
              ],
            },
          },
        }),
      );
      await page.route(/\/api\/litellm\/teams\/[^/?]+(\?|$)/, (route) =>
        route.fulfill({
          json: {
            data: {
              connected: false,
              spendSource: "member-sum",
              daily: [],
              memberSum: {
                total: 0,
                daily: [],
                coverage: { members: 0, matched: 0, unmatched: 0, pending: 0 },
                members: [],
              },
            },
          },
        }),
      );
      await page.goto(`${AREA}/organisation`);
      await waitForHydration(page);

      const [response] = await Promise.all([
        page.waitForResponse(
          // A Link click is a client navigation: the page arrives as an RSC fetch.
          (r) => new URL(r.url()).pathname === "/dashboard/team-usage",
        ),
        page.getByRole("link", { name: "Open the team page" }).click(),
      ]);
      expect(response.status()).toBe(200);
      await expect(page).toHaveURL(
        /\/dashboard\/team-usage\?.*team=team-payments/,
      );
      await waitForHydration(page);
      await expect(
        page.getByRole("region", { name: "Team spend", exact: true }),
      ).toBeVisible();
    });
  }

  test("an unknown tab is the 404 even for an admin", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    const response = await page.goto(`${AREA}/nope`);
    expect(response?.status()).toBe(404);
  });
});

// Design System - Routes and redirects (D3): the Location keeps the query.
test.describe("moved URLs redirect on the server and keep their query (M1 D3)", () => {
  for (const [from, to] of [
    ["/dashboard/manage/organisation", `${AREA}/organisation`],
    ["/dashboard/litellm?tab=organisation", `${AREA}/organisation`],
    ["/dashboard/settings/litellm/team-links", `${AREA}/teams`],
    ["/dashboard/settings/litellm/users", `${AREA}/users`],
  ] as const) {
    test(`${from} -> ${to}, range kept`, async ({ page, context }) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await mockApi(page);
      const url = `${from}${from.includes("?") ? "&" : "?"}${RANGE}`;
      const response = await page.request.get(url, { maxRedirects: 0 });
      expect([307, 308]).toContain(response.status());
      const location = new URL(response.headers().location ?? "", "http://x");
      expect(location.pathname.endsWith(to)).toBe(true);
      expect(location.searchParams.get("dateFrom")).toBe("2026-10-01");
      expect(location.searchParams.get("dateTo")).toBe("2026-10-03");
      expect(location.searchParams.has("tab")).toBe(false);

      await page.goto(url);
      await waitForHydration(page);
      await expect(page).toHaveURL(
        new RegExp(`${to}\\?.*dateFrom=2026-10-01.*dateTo=2026-10-03`),
      );
    });
  }

  test("a user following a moved URL gets the 404 at the target", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page);
    const response = await page.goto(
      `/dashboard/settings/litellm/team-links?${RANGE}`,
    );
    expect(response?.status()).toBe(404);
  });
});

// Design System - Responsive; Rule 40.6: axe and no horizontal scroll on the
// new area pages, 375 and 1440 (the tab row scrolls inside itself).
test.describe("LiteLLM area layout and accessibility (M1)", () => {
  for (const tab of ["organisation", "teams", "users"]) {
    for (const width of [375, 1440]) {
      test(`${AREA}/${tab} is axe-clean with no horizontal scroll at ${width}px`, async ({
        page,
        context,
      }) => {
        await signInAsTestUser(context, { roles: ["internal-admin"] });
        await mockApi(page);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${AREA}/${tab}`);
        await waitForHydration(page);
        await expect(tabRow(page)).toBeVisible();
        await expect(page.getByRole("region").first()).toBeVisible();

        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          overflow.scrollWidth,
          `${tab} overflows horizontally at ${width}px`,
        ).toBeLessThanOrEqual(overflow.clientWidth);
        await expectNoBlockingViolations(page);
      });
    }
  }
});
