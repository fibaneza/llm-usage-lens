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
  test("an Admin sees Connection, Guardrails, Team links and Users tabs, Connection first", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await openSettings(page);
    const tabs = page
      .getByRole("tab")
      .filter({ hasText: /^(Connection|Guardrails|Team links|Users)$/ });
    expect((await tabs.allTextContents()).map((t) => t.trim())).toEqual([
      "Connection",
      "Guardrails",
      "Team links",
      "Users",
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
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Connection changed, reload",
    );
  });
});

// docs/specs/2026-11-10-litellm.md LD24 (org-admin edits Guardrails and Team
// links, Connection read-only; Auditor read-only), LT20 / LT22; Design System
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
