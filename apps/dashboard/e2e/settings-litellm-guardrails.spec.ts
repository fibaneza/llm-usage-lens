import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// docs/specs/2026-11-10-litellm.md -- "Guardrail configuration" (LD19:
// effective value and source ui|file|spec per operation, writes and reads;
// "reset to file defaults"; the code-only guardrails shown read-only),
// "Gateway guardrails" item 6 (wildcard warning on the panel),
// implementation-phases L2. The API is a stateful in-test fake served through
// page.route, so nothing reaches the internet (Rule 60.24).
type Source = "ui" | "file" | "spec";

// Mirrors the real route's PUT contract (app/api/litellm/toggles): `version`
// is null (create, nothing saved) or the saved version (>= 1); the literal 0
// GET reports for "nothing saved" is a 400, a stale one a 409.
function createFakeToggles(startVersion = 4) {
  let version = startVersion;
  const saved: Record<string, boolean> = {};
  const defaults: Record<string, boolean> = {
    createTeam: true,
    deleteKey: false,
    listKeys: true,
    getTeam: true,
  };
  const puts: unknown[] = [];
  const view = () => ({
    version,
    edition: "oss",
    operations: Object.fromEntries(
      Object.entries(defaults).map(([op, def]) => [
        op,
        op in saved
          ? { enabled: saved[op], source: "ui" satisfies Source }
          : { enabled: def, source: "file" satisfies Source },
      ]),
    ),
  });
  return {
    puts,
    view,
    put(body: {
      version: number | null;
      toggles?: Record<string, boolean>;
      reset?: true;
    }): { status: number; json: unknown } {
      puts.push(body);
      const accepted =
        body.version === null
          ? version === 0 && !body.reset
          : Number.isInteger(body.version) && body.version >= 1;
      if (body.version !== null && body.version < 1) {
        return {
          status: 400,
          json: { error: { code: "BAD_REQUEST", message: "Invalid input" } },
        };
      }
      if (!accepted || (body.version !== null && body.version !== version)) {
        return {
          status: 409,
          json: { error: { code: "CONFLICT", message: "Toggles changed" } },
        };
      }
      if (body.reset) {
        for (const k of Object.keys(saved)) delete saved[k];
      } else {
        Object.assign(saved, body.toggles);
      }
      version += 1;
      return { status: 200, json: { data: view() } };
    },
  };
}

async function mockApi(page: Page, fake: ReturnType<typeof createFakeToggles>) {
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/accounts(\?|$)/, (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route(/\/api\/litellm\/connection\/test$/, (route) =>
    route.fulfill({
      json: {
        data: {
          result: "ok",
          message: "Connection ok",
          warnings: [
            "service key uses temporary wildcards (`/team/*`, `/key/*`)",
          ],
        },
      },
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
  await page.route(/\/api\/litellm\/toggles$/, (route) => {
    const req = route.request();
    if (req.method() === "PUT") {
      const { status, json } = fake.put(req.postDataJSON());
      return route.fulfill({ status, json });
    }
    return route.fulfill({ json: { data: fake.view() } });
  });
}

async function openPanel(page: Page) {
  await page.goto("/dashboard/settings");
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { level: 2, name: "LiteLLM" }),
  ).toBeVisible();
}

test.describe("settings LiteLLM guardrail configuration", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
  });

  test("shows each operation's effective value with its source, and the code-only guardrails", async ({
    page,
  }) => {
    await mockApi(page, createFakeToggles());
    await openPanel(page);

    await expect(
      page.getByRole("switch", { name: "createTeam" }),
    ).toBeChecked();
    await expect(
      page.getByRole("switch", { name: "deleteKey" }),
    ).not.toBeChecked();
    await expect(page.getByRole("switch", { name: "listKeys" })).toBeChecked();
    await expect(page.getByTestId("litellm-op-source-listKeys")).toHaveText(
      /^file$/i,
    );
    await expect(
      page.getByRole("region", { name: /enforced in code/i }),
    ).toBeVisible();
  });

  test("toggling a read off shows source ui; reset to file defaults restores source file", async ({
    page,
  }) => {
    const fake = createFakeToggles();
    await mockApi(page, fake);
    await openPanel(page);

    await page.getByRole("switch", { name: "listKeys" }).click();
    await expect(
      page.getByRole("switch", { name: "listKeys" }),
    ).not.toBeChecked();
    await expect(page.getByTestId("litellm-op-source-listKeys")).toHaveText(
      /^ui$/i,
    );
    expect(fake.puts[0]).toEqual({ version: 4, toggles: { listKeys: false } });

    await page.getByRole("button", { name: /reset to file defaults/i }).click();
    await page.getByRole("button", { name: /^confirm reset$/i }).click();
    await expect(page.getByRole("switch", { name: "listKeys" })).toBeChecked();
    await expect(page.getByTestId("litellm-op-source-listKeys")).toHaveText(
      /^file$/i,
    );
    expect(fake.puts[1]).toEqual({ version: 5, reset: true });
  });

  test("the connection test shows the temporary-wildcards warning", async ({
    page,
  }) => {
    await mockApi(page, createFakeToggles());
    await openPanel(page);
    await expect(page.getByTestId("litellm-wildcard-warning")).toHaveCount(0);
    await page.getByRole("button", { name: /test connection/i }).click();
    await expect(page.getByTestId("litellm-wildcard-warning")).toContainText(
      /temporary wildcards/i,
    );
  });

  test("a fresh deployment (version 0): the first save succeeds and Reset is not offered until something is saved", async ({
    page,
  }) => {
    const fake = createFakeToggles(0);
    await mockApi(page, fake);
    await openPanel(page);

    const reset = page.getByRole("button", { name: /reset to file defaults/i });
    if ((await reset.count()) > 0) await expect(reset).toBeDisabled();

    await page.getByRole("switch", { name: "listKeys" }).click();
    await expect(
      page.getByRole("switch", { name: "listKeys" }),
    ).not.toBeChecked();
    await expect(page.getByTestId("litellm-op-source-listKeys")).toHaveText(
      /^ui$/i,
    );
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    expect(fake.puts[0]).toEqual({
      version: null,
      toggles: { listKeys: false },
    });

    await expect(reset).toBeEnabled();
  });
});
