import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// docs/specs/2026-11-10-litellm.md -- "Page and Settings" (Admin LiteLLM
// panel in Settings), "Security architecture" item 6 (service-key status and
// connection test only, no key entry); implementation-phases L1. The API is
// fulfilled from fixtures (Rule 60.24).
async function mockApi(page: Page) {
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/accounts(\?|$)/, (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route(/\/api\/litellm\/connection\/test$/, (route) =>
    route.fulfill({
      json: { data: { result: "ok", message: "Connection ok" } },
    }),
  );
  await page.route(/\/api\/litellm\/connection$/, (route) =>
    route.fulfill({
      json: {
        data: {
          baseUrl: "https://litellm.example.internal",
          version: 1,
          edition: "oss",
          serviceKeyConfigured: true,
        },
      },
    }),
  );
}

async function openSettings(page: Page) {
  await page.goto("/dashboard/settings/litellm");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test.describe("settings LiteLLM tabs (L3b)", () => {
  test("an Admin sees Connection, Guardrails, Team links, Users and Gateway tabs, Connection first", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await openSettings(page);
    const tabs = page.getByRole("tab").filter({
      hasText: /^(Connection|Guardrails|Team links|Users|Gateway)$/,
    });
    expect((await tabs.allTextContents()).map((t) => t.trim())).toEqual([
      "Connection",
      "Guardrails",
      "Team links",
      "Users",
      "Gateway",
    ]);
    await expect(page.getByRole("tab", { name: "Connection" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Users" }).click();
    await expect(
      page.getByRole("searchbox", { name: /search users/i }),
    ).toBeVisible();
  });
});

// L3b review (UI warning): the Settings -> LiteLLM data tabs get an axe scan
// (WCAG 2.1 AA, serious or critical only); fixtures only (Rule 60.24).
test.describe("settings LiteLLM tabs accessibility (L3b)", () => {
  async function scanTab(page: Page, tab: string, ready: () => Promise<void>) {
    await page.route(/\/api\/litellm\/team-links(\?|$)/, (route) =>
      route.fulfill({
        json: {
          data: {
            items: [
              {
                teamId: "payments",
                litellmTeamId: "ll-111",
                version: 1,
                updatedAt: "2026-11-01T00:00:00Z",
              },
            ],
          },
        },
      }),
    );
    await page.getByRole("tab", { name: tab }).click();
    await ready();
    // Next streams metadata after first paint; axe document-title needs it.
    await expect(page).toHaveTitle(/\S/);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => v.id),
    ).toEqual([]);
  }

  test("the Users tab has no serious or critical axe violations", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await openSettings(page);
    await scanTab(page, "Users", () =>
      expect(
        page.getByRole("searchbox", { name: /search users/i }),
      ).toBeVisible(),
    );
  });

  test("the Team links tab has no serious or critical axe violations", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await openSettings(page);
    await scanTab(page, "Team links", () =>
      expect(page.getByText("ll-111")).toBeVisible(),
    );
  });
});

test.describe("settings LiteLLM section", () => {
  test("renders for internal-admin with status, no key input, and a working connection test", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await openSettings(page);

    await expect(
      page.getByRole("heading", { level: 2, name: "LiteLLM" }),
    ).toBeVisible();
    await expect(
      page.getByText("https://litellm.example.internal"),
    ).toBeVisible();
    await expect(page.getByText(/service key configured/i)).toContainText(
      /yes/i,
    );
    await expect(page.getByLabel(/service key|api key|secret/i)).toHaveCount(0);

    await page.getByRole("button", { name: /test connection/i }).click();
    await expect(page.getByText("Connection ok")).toBeVisible();
  });

  // Unit D: the panel is its own tab. Slice B2 (B2-10): Settings is closed to a
  // user, so there is no tab row at all and every Settings URL, the LiteLLM
  // one included, is the 404 page (Design System "Settings Page"; LiteLLM
  // LD24; Access Control - Navigation and landing by role).
  test("is absent for internal-viewer: no Settings, and the tab URLs are a 404", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page);
    const registry = await page.goto("/dashboard/settings/accounts");
    expect(registry?.status()).toBe(404);
    await expect(page.getByRole("tab", { name: "LiteLLM" })).toHaveCount(0);

    const response = await page.goto("/dashboard/settings/litellm");
    expect(response?.status()).toBe(404);
    for (const section of [
      "connection",
      "guardrails",
      "team-links",
      "users",
      "gateway",
    ]) {
      const sub = await page.goto(`/dashboard/settings/litellm/${section}`);
      expect(sub?.status()).toBe(404);
    }
    await expect(page.getByRole("heading", { name: "LiteLLM" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /test connection/i }),
    ).toHaveCount(0);
  });
});

// docs/specs/2026-11-10-litellm.md -- "Security architecture" item 7 (base URL
// Admin-set in Settings, versioned), implementation-phases L1.
test.describe("settings LiteLLM base URL entry", () => {
  const NEW_URL = "https://litellm-b.example.internal";

  test("an admin saves a new base URL with the current version and sees it", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    let putBody: unknown;
    await page.route(/\/api\/litellm\/connection$/, (route) => {
      const req = route.request();
      if (req.method() === "PUT") {
        putBody = req.postDataJSON();
        return route.fulfill({
          json: {
            data: {
              baseUrl: NEW_URL,
              version: 2,
              edition: "oss",
              serviceKeyConfigured: true,
            },
          },
        });
      }
      return route.fulfill({
        json: {
          data: {
            baseUrl: "https://litellm.example.internal",
            version: 1,
            edition: "oss",
            serviceKeyConfigured: true,
          },
        },
      });
    });
    await openSettings(page);

    const input = page.getByLabel(/base url/i);
    await expect(input).toHaveValue("https://litellm.example.internal");
    await input.fill(NEW_URL);
    await page.getByRole("button", { name: /^save/i }).click();
    await expect(page.getByText(NEW_URL, { exact: true })).toBeVisible();
    expect(putBody).toEqual({ baseUrl: NEW_URL, version: 1 });
    await expect(page.getByLabel(/service key|api key|secret/i)).toHaveCount(0);
  });

  test("a rejected save shows the error inline", async ({ page, context }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await page.route(/\/api\/litellm\/connection$/, (route) => {
      if (route.request().method() === "PUT") {
        return route.fulfill({
          status: 409,
          json: {
            error: { code: "CONFLICT", message: "Connection changed, reload" },
          },
        });
      }
      return route.fulfill({
        json: {
          data: {
            baseUrl: "https://litellm.example.internal",
            version: 1,
            edition: "oss",
            serviceKeyConfigured: true,
          },
        },
      });
    });
    await openSettings(page);
    await page.getByLabel(/base url/i).fill(NEW_URL);
    await page.getByRole("button", { name: /^save/i }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Connection changed, reload",
    );
  });
});

// docs/specs/2026-11-10-litellm.md LD24 (org-admin edits Guardrails and Team
// links, Connection read-only; Auditor read-only), LT22; Design System
// -- Settings -> LiteLLM; implementation-phases L3d2. Fixtures only.
test.describe("settings LiteLLM by role (LD24)", () => {
  async function mockConfigApi(page: Page) {
    await mockApi(page);
    await page.route(/\/api\/litellm\/toggles$/, (route) =>
      route.fulfill({
        json: {
          data: {
            version: 2,
            edition: "oss",
            operations: {
              createTeam: { enabled: true, source: "file" },
              getTeam: { enabled: true, source: "file" },
            },
          },
        },
      }),
    );
    await page.route(/\/api\/litellm\/team-links(\?|$)/, (route) =>
      route.fulfill({
        json: {
          data: {
            items: [
              {
                teamId: "payments",
                litellmTeamId: "ll-111",
                version: 1,
                updatedAt: "2026-11-01T00:00:00Z",
              },
            ],
          },
        },
      }),
    );
  }

  test("an Auditor sees Settings -> LiteLLM read-only", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockConfigApi(page);
    await openSettings(page);

    await expect(
      page.getByRole("heading", { level: 2, name: "LiteLLM" }),
    ).toBeVisible();
    await expect(
      page.getByText("https://litellm.example.internal"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^save/i })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /test connection/i }),
    ).toHaveCount(0);

    await page.getByRole("tab", { name: "Guardrails" }).click();
    await expect(page.getByTestId("litellm-op-createTeam")).toBeVisible();
    await expect(page.getByRole("switch")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /reset to defaults/i }),
    ).toHaveCount(0);

    await page.getByRole("tab", { name: "Team links" }).click();
    await expect(page.getByText("ll-111")).toBeVisible();
    await expect(page.getByRole("button", { name: /^unlink/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^link$/i })).toHaveCount(0);
  });

  test("an org-admin cannot edit Connection but edits Guardrails and Team links", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockConfigApi(page);
    await openSettings(page);

    await expect(
      page.getByText("https://litellm.example.internal"),
    ).toBeVisible();
    await expect(page.getByLabel(/base url/i)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /test connection/i }),
    ).toHaveCount(0);

    await page.getByRole("tab", { name: "Guardrails" }).click();
    await expect(
      page.getByRole("switch", { name: "createTeam" }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Team links" }).click();
    await expect(page.getByLabel("Dashboard team ID")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unlink payments" }),
    ).toBeVisible();
  });
});

// Unit A2. Design System "Settings Page" - LiteLLM sub-tabs (2026-11-17): the
// second route-tab row (links, aria-current="page"), the redirect of the index,
// old #slug links, Back across sub-tabs (gap G3, closed for Settings), the 404
// for an unknown section, and the G7 empty states. Fixtures only (Rule 60.24).
test.describe("settings LiteLLM route sub-tabs (unit A2)", () => {
  const BASE = "/dashboard/settings/litellm";
  const sub = (page: Page) =>
    page.getByRole("tablist", { name: "LiteLLM sections" });

  async function mockEmptyLinks(page: Page) {
    await page.route(/\/api\/litellm\/team-links(\?|$)/, (route) =>
      route.fulfill({ json: { data: { items: [] } } }),
    );
    await page.route(/\/api\/litellm\/toggles$/, (route) =>
      route.fulfill({
        json: { data: { version: 0, edition: "oss", operations: {} } },
      }),
    );
  }

  test("the index lands on Connection, marked aria-current; Back steps from Guardrails to Connection", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await mockEmptyLinks(page);
    await page.goto(BASE);
    await waitForHydration(page);
    await expect(page).toHaveURL(`${BASE}/connection`);
    await expect(
      sub(page).getByRole("tab", { name: "Connection" }),
    ).toHaveAttribute("aria-current", "page");

    await sub(page).getByRole("tab", { name: "Guardrails" }).click();
    await expect(page).toHaveURL(`${BASE}/guardrails`);
    await expect(
      sub(page).getByRole("tab", { name: "Guardrails" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      sub(page).getByRole("tab", { name: "Connection" }),
    ).not.toHaveAttribute("aria-current");

    await page.goBack();
    await expect(page).toHaveURL(`${BASE}/connection`);
    await expect(
      sub(page).getByRole("tab", { name: "Connection" }),
    ).toHaveAttribute("aria-current", "page");
  });

  for (const role of [
    "internal-admin",
    "internal-org-admin",
    "internal-auditor",
  ]) {
    test(`${role} sees the five sub-tabs in order`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      await mockApi(page);
      await page.goto(`${BASE}/connection`);
      await waitForHydration(page);
      expect(
        (await sub(page).getByRole("tab").allTextContents()).map((t) =>
          t.trim(),
        ),
      ).toEqual(["Connection", "Guardrails", "Team links", "Users", "Gateway"]);
    });
  }

  test("an old #guardrails link lands on the Guardrails route", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await mockEmptyLinks(page);
    await page.goto(`${BASE}#guardrails`);
    await expect(page).toHaveURL(`${BASE}/guardrails`);
  });

  test("an old #team-links link on the Settings root lands on the Team links route", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await mockEmptyLinks(page);
    await page.goto("/dashboard/settings#team-links");
    await expect(page).toHaveURL(`${BASE}/team-links`);
  });

  test("an unknown section is the 404 page, even for an admin", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    const response = await page.goto(`${BASE}/nope`);
    expect(response?.status()).toBe(404);
  });

  test("Team links with no team linked explains the empty state; an editor is pointed at the form", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await mockEmptyLinks(page);
    await page.goto(`${BASE}/team-links`);
    await waitForHydration(page);
    const status = page.getByRole("status").filter({
      hasText: "No LiteLLM team is linked yet.",
    });
    await expect(status).toContainText(/the form below links one/i);
    await expect(page.getByLabel("Dashboard team ID")).toBeVisible();
  });

  test("Team links with no team linked tells an auditor who links teams", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page);
    await mockEmptyLinks(page);
    await page.goto(`${BASE}/team-links`);
    await waitForHydration(page);
    await expect(
      page.getByRole("status").filter({
        hasText: "No LiteLLM team is linked yet.",
      }),
    ).toContainText(/an admin or org-admin links teams/i);
  });

  test("Users with no team linked explains what the search lists", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await mockEmptyLinks(page);
    await page.goto(`${BASE}/users`);
    await waitForHydration(page);
    await expect(
      page.getByRole("status").filter({
        hasText: /user search lists litellm users/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: /search users/i }),
    ).toBeVisible();
  });
});

// L4b review round 1 (playwright-ui-reviewer BLOCKER). docs/specs/2026-11-17-app-teams.md
// - UI (Settings -> LiteLLM -> Team links: a "Spend source" column for every
// app team); no earlier fixture carried `appTeams`, so the table never
// rendered in a browser. Fixtures only (Rule 60.24).
test.describe("settings LiteLLM Team links - spend source table (L4b)", () => {
  test("lists a linked and an unlinked app team with their spend source and is axe-clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await page.route(/\/api\/litellm\/team-links(\?|$)/, (route) =>
      route.fulfill({
        json: {
          data: {
            items: [
              {
                teamId: "payments",
                litellmTeamId: "ll-111",
                version: 1,
                updatedAt: "2026-11-01T00:00:00Z",
              },
            ],
            appTeams: [
              {
                teamId: "payments",
                teamName: "Payments",
                spendSource: "litellm-team",
              },
              {
                teamId: "growth",
                teamName: "Growth",
                spendSource: "member-sum",
              },
            ],
          },
        },
      }),
    );
    await page.route(/\/api\/litellm\/toggles$/, (route) =>
      route.fulfill({
        json: { data: { version: 0, edition: "oss", operations: {} } },
      }),
    );
    await page.goto("/dashboard/settings/litellm/team-links");
    await waitForHydration(page);

    const table = page.getByRole("table", { name: "Spend source by app team" });
    await expect(table).toBeVisible();
    await expect(
      table
        .getByRole("row", { name: /Payments/ })
        .getByRole("cell", { name: "LiteLLM team" }),
    ).toBeVisible();
    await expect(
      table
        .getByRole("row", { name: /Growth/ })
        .getByRole("cell", { name: "Sum of members" }),
    ).toBeVisible();

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
});

// Unit L6. docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)" -> Where each figure appears (Settings -> LiteLLM -> Gateway at
// /dashboard/settings/litellm/gateway: Admin edits the principal and account
// lists; Auditor and org-admin read only, LD24; Lead and user 404; save sends
// the version; 409 shows 'Changed elsewhere - reload'); Design System
// "Settings Page". The API is fulfilled from fixtures (Rule 60.24). Labels and
// copy are the contract of LiteLLMGatewaySection.test.tsx.
test.describe("settings LiteLLM Gateway sub-tab (L6)", () => {
  const PATH = "/dashboard/settings/litellm/gateway";
  const VIEW = {
    gatewayConfigured: true,
    version: 3,
    principals: [{ type: "iam-role", value: "litellm-gateway" }],
    accountIds: ["111122223333"],
    updatedAt: "2026-11-14T10:00:00.000Z",
    updatedBy: "oid-admin",
  };

  async function mockGateway(page: Page) {
    await mockApi(page);
    const puts: unknown[] = [];
    await page.route(/\/api\/litellm\/gateway$/, (route) => {
      const req = route.request();
      if (req.method() === "PUT") {
        puts.push(req.postDataJSON());
        return route.fulfill({
          status: 409,
          json: { error: { code: "CONFLICT", message: "reload" } },
        });
      }
      return route.fulfill({ json: { data: VIEW } });
    });
    return puts;
  }

  test("an Admin edits the lists; a stale save shows 'Changed elsewhere — reload' and sent the loaded version", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    const puts = await mockGateway(page);
    await page.goto(PATH);
    await waitForHydration(page);
    await expect(
      page
        .getByRole("tablist", { name: "LiteLLM sections" })
        .getByRole("tab", { name: "Gateway" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Principal 1 value")).toHaveValue(
      "litellm-gateway",
    );
    await expect(page.getByLabel("Account ID 1")).toHaveValue("111122223333");
    await page.getByRole("button", { name: "Add account" }).click();
    await page.getByLabel("Account ID 2").fill("000000000002");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Changed elsewhere — reload",
    );
    expect(puts).toEqual([
      {
        version: 3,
        principals: [{ type: "iam-role", value: "litellm-gateway" }],
        accountIds: ["111122223333", "000000000002"],
      },
    ]);
  });

  for (const role of ["internal-auditor", "internal-org-admin"]) {
    test(`${role} reads the Gateway sub-tab and cannot edit`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      await mockGateway(page);
      await page.goto(PATH);
      await waitForHydration(page);
      await expect(page.getByText("litellm-gateway")).toBeVisible();
      await expect(page.getByText("111122223333")).toBeVisible();
      await expect(page.getByRole("textbox")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^add / })).toHaveCount(0);
    });
  }

  // Design System - Layout (no page-level horizontal scroll at 375, Rule 40.6);
  // L6 review round 1 (overflow check on the populated form). Long unbroken
  // values are the worst case: a 64-character iam-role, a 200-character
  // usage-key and the 10 account ids the schema allows.
  test("a populated config has no horizontal scroll at 375px", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockGateway(page);
    const populated = {
      ...VIEW,
      principals: [
        { type: "iam-role", value: "r".repeat(64) },
        { type: "usage-key", value: "k".repeat(200) },
      ],
      accountIds: Array.from(
        { length: 10 },
        (_, i) => `1111222233${String(i).padStart(2, "0")}`,
      ),
    };
    await page.route(/\/api\/litellm\/gateway$/, (route) =>
      route.fulfill({ json: { data: populated } }),
    );
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(PATH);
    await waitForHydration(page);
    await expect(page.getByLabel("Principal 2 value")).toBeVisible();
    await expect(page.getByLabel("Account ID 10")).toBeVisible();
    const widths = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.innerWidth);
  });

  test("a Viewer gets the 404 page", async ({ page, context }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockGateway(page);
    const response = await page.goto(PATH);
    expect(response?.status()).toBe(404);
  });

  test("has no serious or critical axe violations", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockGateway(page);
    await page.goto(PATH);
    await waitForHydration(page);
    await expect(page.getByLabel("Principal 1 value")).toBeVisible();
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
});
