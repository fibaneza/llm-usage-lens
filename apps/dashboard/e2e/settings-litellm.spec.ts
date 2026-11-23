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
  test("an Admin sees Connection, Guardrails and Gateway tabs, Connection first (Team links and Users moved to Management, D3)", async ({
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
      "Gateway",
    ]);
    await expect(page.getByRole("tab", { name: "Connection" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

// The Users and Team links tabs left Settings (M1 D3); their axe scan is in
// e2e/manage-litellm.spec.ts.

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
    // D-ST4 ( Design System - Settings, LiteLLM connection): a green
    // check and the text, in an aria-live region (never colour alone).
    const live = page.locator("[aria-live]", {
      hasText: "LiteLLM connection is ok",
    });
    await expect(live).toBeVisible();
    await expect(live.locator("svg")).not.toHaveCount(0);
  });

  test("a failed connection test shows a red cross and the error text in an aria-live region", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await page.route(/\/api\/litellm\/connection\/test$/, (route) =>
      route.fulfill({
        json: {
          data: { result: "unreachable", message: "Gateway unreachable" },
        },
      }),
    );
    await openSettings(page);
    await page.getByRole("button", { name: /test connection/i }).click();
    const live = page.locator("[aria-live]", {
      hasText: "Gateway unreachable",
    });
    await expect(live).toBeVisible();
    await expect(live.locator("svg")).not.toHaveCount(0);
    await expect(page.getByText("LiteLLM connection is ok")).toHaveCount(0);
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

  // LiteLLM spec - GET /api/litellm/connection `defaultBaseUrl` (the
  // LLM_LENS_LITELLM_BASE_URL default): an unsaved connection pre-fills the
  // Base URL field with it.
  test("an unsaved connection pre-fills the Base URL field with the default", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await page.route(/\/api\/litellm\/connection$/, (route) =>
      route.fulfill({
        json: {
          data: {
            baseUrl: null,
            defaultBaseUrl: "https://litellm.default.internal",
            version: 0,
            edition: "oss",
            serviceKeyConfigured: true,
          },
        },
      }),
    );
    await openSettings(page);
    await expect(page.getByLabel(/base url/i)).toHaveValue(
      "https://litellm.default.internal",
    );
  });

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
  });

  test("an org-admin cannot edit Connection but edits Guardrails (Team links moved to Management, D3)", async ({
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
    test(`${role} sees the three sub-tabs in order`, async ({
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
      ).toEqual(["Connection", "Guardrails", "Gateway"]);
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

  // Design System - Routes and redirects, "Old hash links" (2026-11-18, M1):
  // an old `#team-links` on the Settings root lands on Management -> LiteLLM
  // teams. The `$` anchor fails a leftover fragment: the target is the bare route.
  test("an old #team-links link on the Settings root lands on Management -> LiteLLM teams (M1)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await mockEmptyLinks(page);
    await page.goto("/dashboard/settings#team-links");
    await expect(page).toHaveURL(/\/dashboard\/manage\/litellm\/teams$/);
  });

  // Design System - Routes and redirects, "Old hash links" (2026-11-18, M1).
  test("an old #users link on the LiteLLM Settings route lands on Management -> LiteLLM users (M1)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page);
    await mockEmptyLinks(page);
    await page.goto(`${BASE}#users`);
    await expect(page).toHaveURL(/\/dashboard\/manage\/litellm\/users$/);
  });

  // Design System - Routes and redirects, "Old hash links" (2026-11-18, M1): a
  // caller who may not see the target gets its missing-page 404. A user
  // (internal-viewer) gets 404 from Settings first, so the Management target is
  // checked directly as well (Access Control - Navigation and landing by role:
  // Management LiteLLM is admin, org admin and auditor only).
  test("a user who follows an old #team-links link gets the 404 page at the target (M1)", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page);
    const settings = await page.goto(`${BASE}#team-links`);
    expect(settings?.status()).toBe(404);
    const target = await page.goto("/dashboard/manage/litellm/teams");
    expect(target?.status()).toBe(404);
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
