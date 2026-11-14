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
  await page.goto("/dashboard/settings");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

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

  test("is absent for internal-viewer", async ({ page, context }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page);
    await openSettings(page);

    await expect(
      page.getByRole("heading", { name: /account registry/i }),
    ).toBeVisible();
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
