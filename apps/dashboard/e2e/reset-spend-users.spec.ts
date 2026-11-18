import AxeBuilder from "@axe-core/playwright";
import {
  type APIResponse,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

import { E2E_BASE_URL, E2E_LITELLM_BASE_URL } from "./support/constants";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";
import { deleteStoredLiteLLMConnection } from "../test/fixtures/e2e-litellm-connection-seed";
import { withLiteLLMStateLock } from "../test/fixtures/e2e-litellm-state-lock";

// Sources: Design System - "Reset spend from the LiteLLM users tab and the
// Users page" (unit RS1, D1-D5): a row action opens a dialog listing the
// person's resettable team memberships (spend, budget or "No budget"); a
// confirm per team POSTs the existing reset-spend route; Management pages -
// *Confirm destructive actions* (Cancel focused first, Escape returns focus);
// implementation-phases RS1 Verify (one mocked case per page, axe at 375 with
// the dialog open); Design System - Responsive (375 / 1440: the document never
// scrolls sideways with the dialog open, review U-W2). The LiteLLM and directory APIs are fulfilled from fixtures
// (Rule 60.24); gating, copy and sequencing are in the component tests, the
// read's scoping in the route's integration test (Rule 60.24a). The real
// browser adds: the dialog in the real shell, focus handling, the request that
// is actually sent, and axe.
const LITELLM_USERS = "/dashboard/manage/litellm/users";
const PEOPLE = "/dashboard/manage/users";
const RESET_URL = "/api/litellm/teams/team-pay/members/oid-ada/reset-spend";

const MEMBERSHIPS = {
  items: [
    { teamId: "team-pay", teamName: "Payments", spend: 6, maxBudget: 10 },
    { teamId: "team-gro", teamName: "Growth", spend: 2.5, maxBudget: null },
  ],
};

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

// The whole document, not just the dialog: a dialog that fits can still push
// the page wider (review U-W2).
async function expectNoHorizontalScroll(page: Page, dialog: Locator) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
}

type Sent = { method: string; path: string; body: string | null };

// The reset-spend writes and the memberships read, shared by both pages.
async function mockReset(page: Page): Promise<Sent[]> {
  const posts: Sent[] = [];
  await page.route(/\/api\/litellm\/users\/[^/]+\/memberships$/, (route) =>
    route.fulfill({ json: { data: MEMBERSHIPS } }),
  );
  await page.route(
    /\/api\/litellm\/teams\/[^/]+\/members\/[^/]+\/reset-spend$/,
    (route) => {
      const request = route.request();
      posts.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
        body: request.postData(),
      });
      return route.fulfill({
        json: { data: { oid: "oid-ada", litellmUserId: "ll-ada" } },
      });
    },
  );
  return posts;
}

async function mockTab(page: Page) {
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/access\/org-units(\?|$)/, (route) =>
    route.fulfill({
      json: { data: { teams: [], departments: [] } },
    }),
  );
  await page.route(/\/api\/litellm\/team-links$/, (route) =>
    route.fulfill({
      json: {
        data: {
          items: [
            {
              teamId: "team-pay",
              litellmTeamId: "ll-1",
              version: 1,
              updatedAt: "2026-11-01T00:00:00Z",
            },
          ],
          configured: true,
        },
      },
    }),
  );
  await page.route(/\/api\/litellm\/users(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        data: {
          page: 1,
          pageSize: 25,
          hasMore: false,
          enabledOperations: ["resetMemberSpend"],
          mayLink: true,
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
                userId: "ll-ada",
                email: "ada@example.test",
                spend: 8.5,
                maxBudget: 150,
                teams: [
                  { teamId: "team-pay", teamName: "Payments" },
                  { teamId: "team-gro", teamName: "Growth" },
                ],
              },
            },
          ],
        },
      },
    }),
  );
}

// The Users page decides `litellmConfigured` and `canResetSpend` on the server
// (the stored connection and the stored toggle, the caller's write right), which
// page.route cannot reach. The case stores the e2e fake LiteLLM connection (as
// dev-login.spec.ts does) and switches resetMemberSpend on for its duration,
// then restores BOTH (also when setup or the run fails), so the table is left
// as found (a connection left behind hides "LiteLLM not configured" from later
// specs): the toggle through the toggles route, the connection by re-saving the
// previous URL, or, when none was stored, deleting the item (the route has no
// DELETE; the helper under test/fixtures does it in DynamoDB Local). Runs for
// the internal-admin the page needs.
//
// Review R4 / U-W1: (1) each restore PUT's status is asserted, so a failed
// restore fails loudly; every restore step still runs, the failures are
// collected and thrown after both, together with the original failure (never
// hiding it). (2) The whole case holds the cross-worker LiteLLM state lock, so
// it cannot overlap manage-users-links (LD37 "not configured") or dev-login
// (needs the stored connection), which share the one connection / toggle.
async function withResetEnabled(
  context: BrowserContext,
  run: () => Promise<void>,
) {
  await withLiteLLMStateLock(async () => {
    const headers = { origin: E2E_BASE_URL };
    const authTime = Math.floor(Date.now() / 1000);
    await signInAsTestUser(context, { roles: ["internal-admin"], authTime });
    const connection = (await (
      await context.request.get("/api/litellm/connection")
    ).json()) as { data: { baseUrl: string | null; version: number } };
    const previousUrl = connection.data.baseUrl;
    type View = {
      data: {
        version: number;
        operations: { resetMemberSpend: { enabled: boolean } };
      };
    };
    const read = async () =>
      (await (
        await context.request.get("/api/litellm/toggles")
      ).json()) as View;
    // Setup sits inside the try: a failed setup assertion still restores
    // whatever was changed before it. `before` is set once the toggle is read.
    let before: View["data"] | undefined;
    let failure: unknown;
    try {
      if (previousUrl !== E2E_LITELLM_BASE_URL) {
        const saved = await context.request.put("/api/litellm/connection", {
          headers,
          data: {
            baseUrl: E2E_LITELLM_BASE_URL,
            version:
              connection.data.version === 0 ? null : connection.data.version,
          },
        });
        expect(saved.status(), await saved.text()).toBe(200);
      }
      before = (await read()).data;
      const turnOn = await context.request.put("/api/litellm/toggles", {
        headers,
        data: {
          version: before.version === 0 ? null : before.version,
          toggles: { resetMemberSpend: true },
        },
      });
      expect(turnOn.status(), await turnOn.text()).toBe(200);
      await run();
    } catch (error) {
      failure = error;
    }

    const restoreFailures: unknown[] = [];
    const restore = async (step: () => Promise<void>) => {
      try {
        await step();
      } catch (error) {
        restoreFailures.push(error);
      }
    };
    const expectOk = async (res: APIResponse, what: string) =>
      expect(res.ok(), `${what}: ${res.status()} ${await res.text()}`).toBe(
        true,
      );
    await restore(async () => {
      if (before === undefined) return;
      const now = (await read()).data;
      await expectOk(
        await context.request.put("/api/litellm/toggles", {
          headers,
          data:
            before.version === 0
              ? { version: now.version, reset: true }
              : {
                  version: now.version,
                  toggles: {
                    resetMemberSpend:
                      before.operations.resetMemberSpend.enabled,
                  },
                },
        }),
        "restoring the resetMemberSpend toggle",
      );
    });
    await restore(async () => {
      if (previousUrl === null) {
        await deleteStoredLiteLLMConnection();
      } else if (previousUrl !== E2E_LITELLM_BASE_URL) {
        const current = (await (
          await context.request.get("/api/litellm/connection")
        ).json()) as { data: { version: number } };
        await expectOk(
          await context.request.put("/api/litellm/connection", {
            headers,
            data: { baseUrl: previousUrl, version: current.data.version },
          }),
          "restoring the LiteLLM connection",
        );
      }
    });

    if (failure !== undefined && restoreFailures.length > 0) {
      throw new AggregateError(
        [failure, ...restoreFailures],
        "the case failed and the restore also failed",
      );
    }
    if (failure !== undefined) throw failure;
    if (restoreFailures.length > 0) {
      throw new AggregateError(restoreFailures, "restoring the LiteLLM state");
    }
  });
}

async function openDialog(page: Page) {
  const trigger = page.getByRole("button", {
    name: "Reset spend for Ada Lovelace",
  });
  await trigger.click();
  const dialog = page.getByRole("alertdialog", {
    name: "Reset spend for Ada Lovelace?",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("list", { name: "Team memberships" }),
  ).toBeVisible();
  return { trigger, dialog };
}

async function confirmOneTeam(
  page: Page,
  posts: Sent[],
  trigger: ReturnType<Page["getByRole"]>,
) {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  const growth = dialog.getByRole("listitem").filter({ hasText: "Growth" });
  await expect(growth).toContainText("No budget");
  const payments = dialog.getByRole("listitem").filter({ hasText: "Payments" });
  await expect(payments).toContainText("$10.00");
  await payments
    .getByRole("button", { name: "Reset spend in Payments" })
    .click();
  await expect(payments).toContainText("Spend reset to $0.00");
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]?.method).toBe("POST");
  expect(posts[0]?.path.endsWith(RESET_URL)).toBe(true);
  expect(posts[0]?.body).toBeNull();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}

test.describe("Reset spend on the LiteLLM users tab (RS1)", () => {
  test("an admin opens the dialog, confirms one team and the reset-spend route is called for that team and person (D2, D3)", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockTab(page);
    const posts = await mockReset(page);
    await page.goto(LITELLM_USERS);
    await waitForHydration(page);
    const { trigger } = await openDialog(page);
    await confirmOneTeam(page, posts, trigger);
  });

  test("the dialog is axe-clean at 375 with no horizontal scroll (Responsive; RS1 Verify)", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await page.setViewportSize({ width: 375, height: 800 });
    await mockTab(page);
    await mockReset(page);
    await page.goto(LITELLM_USERS);
    await waitForHydration(page);
    const { dialog } = await openDialog(page);
    await expectNoBlockingViolations(page);
    await expectNoHorizontalScroll(page, dialog);
  });

  test("the document does not scroll sideways at 1440 with the dialog open (Responsive; U-W2)", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockTab(page);
    await mockReset(page);
    await page.goto(LITELLM_USERS);
    await waitForHydration(page);
    const { dialog } = await openDialog(page);
    await expectNoHorizontalScroll(page, dialog);
  });
});

test.describe("Reset spend on the Users page (RS1)", () => {
  // Both cases switch the one stored toggle on and restore it.
  test.describe.configure({ mode: "serial" });
  const DIRECTORY = {
    items: [
      {
        oid: "oid-ada",
        displayName: "Ada Lovelace",
        email: "ada@example.test",
        authMethod: "entra",
        memberTeamId: null,
        litellm: { state: "linked", litellmUserId: "ll-ada" },
        linkVersion: 2,
        match: null,
      },
    ],
  };
  const mockPage = async (page: Page) => {
    await page.route(/\/api\/identities\/directory/, (route) =>
      route.fulfill({ json: { data: DIRECTORY } }),
    );
    return mockReset(page);
  };

  test("an admin opens the dialog from a linked person, confirms one team and the reset-spend route is called (D2, D3)", async ({
    context,
    page,
  }) => {
    await withResetEnabled(context, async () => {
      const posts = await mockPage(page);
      await page.goto(PEOPLE);
      await waitForHydration(page);
      const { trigger } = await openDialog(page);
      await confirmOneTeam(page, posts, trigger);
    });
  });

  test("the dialog is axe-clean at 375 (Responsive; RS1 Verify)", async ({
    context,
    page,
  }) => {
    await withResetEnabled(context, async () => {
      await page.setViewportSize({ width: 375, height: 800 });
      await mockPage(page);
      await page.goto(PEOPLE);
      await waitForHydration(page);
      const { dialog } = await openDialog(page);
      await expectNoBlockingViolations(page);
      await expectNoHorizontalScroll(page, dialog);
    });
  });

  test("the document does not scroll sideways at 1440 with the dialog open (Responsive; U-W2)", async ({
    context,
    page,
  }) => {
    await withResetEnabled(context, async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockPage(page);
      await page.goto(PEOPLE);
      await waitForHydration(page);
      const { dialog } = await openDialog(page);
      await expectNoHorizontalScroll(page, dialog);
    });
  });
});
