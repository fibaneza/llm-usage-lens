import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";
import { withLiteLLMStateLock } from "../test/fixtures/e2e-litellm-state-lock";

// Sources: Design System - "Sync from LiteLLM" (unit SYNC1: the button on
// Management -> Users for admin and org-admin; the dialog with counts, rows by
// outcome, skips in words, drift; Apply and Continue; a truncated plan cannot
// be applied; the people not placed with a link to the Users list; the three
// 409 states PLAN_CHANGED, SYNC_RUNNING, PLAN_TRUNCATED; the "Not signed in
// yet" panel) and Access Control - "LiteLLM user sync" Tests table, UI row (the
// action is absent for a role without it; the dialog shows counts, skips,
// drift and the unplaced people; Continue appears with `remaining`; Apply is
// disabled for a truncated plan; the three 409 states; axe at 375 with the
// dialog open). Component tests hold the detail (Rule 60.24a); this covers the
// real shell, the sign-in and the layout. Every API call is fulfilled by
// page.route (Rule 60.24: no real LiteLLM).
//
// The Users page decides on the server whether LiteLLM is configured and the
// sync toggle is on, and the harness cannot store or clear the one LiteLLM
// connection (see manage-users-links.spec.ts), so the cases that need the
// button run only where the server reports LiteLLM configured and skip
// otherwise; the auditor case runs everywhere.
const HASH_A = "a".repeat(64);
const SYNC = /\/api\/identities\/litellm-sync/;

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
const PENDING = {
  items: [
    {
      email: "waiting@example.test",
      litellmUserId: "lu-wait",
      version: 1,
      createdAt: "2026-11-20T10:00:00.000Z",
    },
  ],
};

const user = (over: Record<string, unknown>) => ({
  litellmUserId: "lu-x",
  email: "x@example.test",
  outcome: "already-linked",
  ...over,
});
const PLAN = {
  configured: true,
  users: [
    user({
      litellmUserId: "lu-ada",
      email: "ada@example.test",
      outcome: "link-existing",
      oid: "oid-ada",
      matchedKey: "oid",
    }),
    user({
      litellmUserId: "lu-bob",
      email: "bob@example.test",
      outcome: "create-pending",
    }),
    user({
      litellmUserId: "lu-cy",
      email: "cy@example.test",
      outcome: "skip",
      reason: "duplicate-email",
    }),
    user({
      litellmUserId: "lu-dee",
      email: "dee@example.test",
      outcome: "already-linked",
    }),
  ],
  memberships: [
    { litellmUserId: "lu-ada", teamId: "team-a", outcome: "add-member" },
  ],
  drift: [{ kind: "not-in-litellm-team", teamId: "team-a", oid: "oid-old" }],
  notPlaced: [],
  counts: {
    toLink: 1,
    toPend: 1,
    alreadyLinked: 1,
    skipped: 1,
    memberships: 1,
  },
  truncated: false,
  planHash: HASH_A,
};
// Result rows exactly as LiteLLMSyncResultSchema allows: no email, a status.
const APPLIED = {
  runId: "run-1",
  results: {
    users: [
      { litellmUserId: "lu-ada", outcome: "link-existing", status: "applied" },
    ],
    memberships: [],
    notPlaced: [{ litellmUserId: "lu-dee", reason: "multiple-teams" }],
  },
  remaining: 0,
};

// Same helper as manage-users-links.spec.ts: read the server's state.
async function litellmIsConfigured(context: BrowserContext) {
  await signInAsTestUser(context, { roles: ["internal-admin"] });
  const res = await context.request.get("/api/litellm/connection");
  expect(res.ok()).toBe(true);
  const { baseUrl } = (await res.json()).data as { baseUrl: string | null };
  await context.clearCookies();
  return baseUrl !== null;
}

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

const noHorizontalScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );

type Mocks = {
  get?: unknown;
  posts?: Array<{ status?: number; json: unknown }>;
};

// Returns the POST bodies the page sent, so a case can assert the hash.
async function mockUsersPage(page: Page, mocks: Mocks = {}) {
  const posted: unknown[] = [];
  const posts = [...(mocks.posts ?? [{ json: { data: APPLIED } }])];
  await page.route(/\/api\/identities\/directory/, (route) =>
    route.fulfill({ json: { data: DIRECTORY } }),
  );
  await page.route(/\/api\/identities\/pending-links/, (route) =>
    route.fulfill({ json: { data: PENDING } }),
  );
  await page.route(SYNC, (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      return route.fulfill({ json: { data: mocks.get ?? PLAN } });
    }
    posted.push(request.postDataJSON());
    const reply = posts.shift() ?? { json: { data: APPLIED } };
    return route.fulfill({ status: reply.status ?? 200, json: reply.json });
  });
  return posted;
}

async function openDialog(page: Page) {
  await page.goto("/dashboard/manage/users");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Sync from LiteLLM" }).click();
  const dialog = page.getByRole("dialog", { name: "Sync from LiteLLM" });
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeVisible();
  return dialog;
}

test.describe("Management -> Users -> Sync from LiteLLM (SYNC1)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ context }) => {
    test.skip(
      !(await litellmIsConfigured(context)),
      "the Sync button needs a stored LiteLLM connection; the CI table has none (testing guide - E2E without LiteLLM)",
    );
    await signInAsTestUser(context, { roles: ["internal-admin"] });
  });

  test("an admin previews, applies and reads the result with the people not placed and a link to the Users list", async ({
    page,
  }) => {
    await withLiteLLMStateLock(async () => {
      const posted = await mockUsersPage(page);
      const dialog = await openDialog(page);

      await expect(dialog.getByTestId("sync-count-toLink")).toContainText("1");
      await expect(
        dialog.getByRole("group", { name: "To link" }),
      ).toContainText("ada@example.test");
      const skipped = dialog.getByRole("group", { name: "Skipped" });
      await expect(skipped).toContainText("cy@example.test");
      await expect(skipped).not.toContainText("duplicate-email");
      await expect(dialog.getByRole("group", { name: "Drift" })).toBeVisible();
      await expect(dialog).toContainText("clean-up of dashboard placeholders");

      await dialog.getByRole("button", { name: "Apply" }).click();
      await expect(dialog.getByRole("group", { name: "Result" })).toBeVisible();
      expect(posted).toEqual([{ planHash: HASH_A }]);
      const unplaced = dialog.getByRole("group", {
        name: "Not placed in a team",
      });
      await expect(unplaced).toContainText("dee@example.test");
      await expect(
        unplaced.getByRole("link", { name: /users list/i }),
      ).toBeVisible();
    });
  });

  test("the Not signed in yet panel sits under People with a Remove for an admin", async ({
    page,
  }) => {
    await mockUsersPage(page);
    await page.goto("/dashboard/manage/users");
    await waitForHydration(page);
    const panel = page.getByRole("region", { name: "Not signed in yet" });
    await expect(panel.getByText("waiting@example.test")).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Remove waiting@example.test" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "People" })
        .getByText("waiting@example.test"),
    ).toHaveCount(0);
  });

  test("a truncated plan says so and Apply is disabled", async ({ page }) => {
    const posted = await mockUsersPage(page, {
      get: { ...PLAN, truncated: true },
    });
    const dialog = await openDialog(page);
    await expect(dialog).toContainText(/truncated/i);
    await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(posted).toEqual([]);
  });

  test("Continue appears while changes remain", async ({ page }) => {
    await mockUsersPage(page, {
      posts: [{ json: { data: { ...APPLIED, remaining: 120 } } }],
    });
    const dialog = await openDialog(page);
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(
      dialog.getByRole("button", { name: "Continue" }),
    ).toBeVisible();
  });

  for (const [code, text] of [
    ["PLAN_CHANGED", "The plan changed — review it again"],
    ["SYNC_RUNNING", /a sync is already running/i],
    ["PLAN_TRUNCATED", /truncated/i],
  ] as const) {
    test(`the 409 ${code} state is shown in the dialog`, async ({ page }) => {
      await mockUsersPage(page, {
        posts: [{ status: 409, json: { error: { code, message: "refused" } } }],
      });
      const dialog = await openDialog(page);
      await dialog.getByRole("button", { name: "Apply" }).click();
      await expect(dialog.getByText(text)).toBeVisible();
    });
  }

  for (const [label, viewport] of [
    ["375", { width: 375, height: 800 }],
    ["1440", { width: 1440, height: 900 }],
  ] as const) {
    test(`with the dialog open at ${label}px there is no serious axe violation and no horizontal scroll`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await mockUsersPage(page);
      await openDialog(page);
      await expectNoBlockingViolations(page);
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  }
});

test.describe("Sync from LiteLLM, a role without the action (T-SY9 UI)", () => {
  test("an auditor sees no Sync from LiteLLM button", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockUsersPage(page);
    await page.goto("/dashboard/manage/users");
    await waitForHydration(page);
    await expect(
      page.getByRole("region", { name: "People" }).getByText("Ada Lovelace"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sync from LiteLLM" }),
    ).toHaveCount(0);
  });
});
