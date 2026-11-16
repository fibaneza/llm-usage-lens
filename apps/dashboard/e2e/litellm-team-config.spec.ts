import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: docs/specs/2026-11-10-litellm.md -- "Team configuration page (L4)"
// (entry via a "Configure team" link in the Team tab; Lead, org-admin and
// Admin only; a Viewer and the Auditor get the standard 404; shown-once key
// dialog), LD25; Design System -- LiteLLM Page. Component behaviour lives in
// TeamConfigContent.test.tsx (Rule 60.24a); this covers the real shell, the
// server gate and axe. The harness cannot forge a team-scope Lead (Lead scope
// lives in DynamoDB), so internal-org-admin stands in for the Lead path. The
// LiteLLM API is fulfilled from fixtures (Rule 60.24).
const KEY_VALUE = "sk-E2E-SHOWN-ONCE";
const OPS = [
  "generateMemberKey",
  "setTeamBudget",
  "setTeamModels",
  "removeTeamMember",
];
const REMOVE_PATH = "/api/litellm/teams/t1/members/oid-ada";
// The page is not in lib/nav.ts, so the smoke, axe and responsive passes
// (smoke.spec.ts, accessibility.spec.ts, responsive.spec.ts) never reach it.
const BREAKPOINTS = [375, 768, 1024, 1440] as const;

async function mockApi(page: Page) {
  await page.route(/\/api\/sync-status(\?|$)/, (route) =>
    route.fulfill({ json: { data: { state: "never-synced" } } }),
  );
  await page.route(/\/api\/litellm\//, (route) => {
    const url = new URL(route.request().url());
    const key = `${route.request().method()} ${url.pathname}`;
    const ok = (data: unknown, status = 200) =>
      route.fulfill({ status, json: { data } });
    switch (key) {
      case "GET /api/litellm/me":
        return ok({
          linked: false,
          enabledOperations: OPS,
          teams: [
            {
              teamId: "t1",
              teamName: "Payments",
              linked: true,
              configurable: true,
            },
          ],
        });
      case "GET /api/litellm/teams/t1":
        return ok({
          connected: true,
          team: {
            alias: "Payments",
            spend: 321.75,
            maxBudget: 500,
            softBudget: null,
            budgetDuration: "30d",
            models: ["claude-sonnet"],
            rpmLimit: null,
            tpmLimit: null,
          },
          daily: [],
          enabledOperations: OPS,
        });
      case "GET /api/litellm/teams/t1/members":
        return ok({
          connected: true,
          items: [
            {
              userId: "u-ada",
              oid: "oid-ada",
              name: "Ada Lovelace",
              email: "ada@example.test",
              spend: 77.1,
              maxBudget: 150,
              rpmLimit: null,
              tpmLimit: null,
            },
          ],
        });
      case "GET /api/litellm/teams/t1/keys":
        return ok({ connected: true, items: [] });
      case "GET /api/litellm/models":
        return ok({ items: ["claude-sonnet", "claude-haiku"] });
      case `DELETE ${REMOVE_PATH}`:
        return ok({ oid: "oid-ada", removed: true });
      case "POST /api/litellm/teams/t1/keys":
        return ok({ tokenId: "tok-new", key: KEY_VALUE, oid: "oid-ada" }, 201);
      default:
        return route.fulfill({
          status: 404,
          json: { error: { code: "NOT_FOUND", message: "not found" } },
        });
    }
  });
}

test.describe("Team configuration page", () => {
  test("a team manager opens it from the Team tab link and generates a key shown once", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockApi(page);
    await page.goto("/dashboard/litellm?tab=team");
    await waitForHydration(page);
    await page.getByRole("link", { name: "Configure team" }).click();
    await expect(page).toHaveURL(/\/dashboard\/litellm\/team-config\?team=t1/);

    for (const name of ["Members", "Keys", "Budget and limits", "Models"]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }

    await page.getByRole("button", { name: "Generate key" }).click();
    const form = page.getByRole("dialog");
    await form
      .getByRole("combobox", { name: "Key owner" })
      .selectOption("oid-ada");
    await form.getByRole("button", { name: "Generate" }).click();

    const shown = page.getByRole("dialog", { name: /key generated/i });
    await expect(shown).toContainText(KEY_VALUE);
    await expect(shown).toContainText(/you will not see this again/i);
    await shown.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText(KEY_VALUE)).toHaveCount(0);
  });

  // Review blocker U2: the page escapes the nav-driven gates, so it carries its
  // own axe (project standard: WCAG 2 A/AA, serious or critical) and the
  // no-horizontal-scroll check (Rule 40.6 breakpoints; responsive.spec.ts).
  for (const width of BREAKPOINTS) {
    test(`has no serious or critical axe violations and no horizontal scroll at ${width}px (Rule 40.6; accessibility.spec.ts)`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await mockApi(page);
      await page.goto("/dashboard/litellm/team-config?team=t1");
      await waitForHydration(page);
      await expect(page.getByRole("region", { name: "Models" })).toBeVisible();

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        `team-config overflows horizontally at ${width}px`,
      ).toBeLessThanOrEqual(overflow.clientWidth);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        blocking.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target.join(" ")),
        })),
      ).toEqual([]);
    });
  }

  // Review blocker U1: the AlertDialog confirm in a real browser (Design
  // System: AlertDialog confirms destructive actions; Radix focus handling).
  test.describe("remove member confirmation", () => {
    const open = async (
      page: Page,
      context: Parameters<typeof signInAsTestUser>[0],
    ) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await mockApi(page);
      const deletes: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "DELETE") deletes.push(request.url());
      });
      await page.goto("/dashboard/litellm/team-config?team=t1");
      await waitForHydration(page);
      const trigger = page.getByRole("button", {
        name: "Remove Ada Lovelace",
      });
      await trigger.click();
      const dialog = page.getByRole("alertdialog", {
        name: "Remove Ada Lovelace?",
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Cancel" }),
      ).toBeFocused();
      return { trigger, dialog, deletes };
    };

    test("Escape closes it, sends no DELETE and returns focus to the trigger", async ({
      page,
      context,
    }) => {
      const { trigger, dialog, deletes } = await open(page, context);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(deletes).toEqual([]);
    });

    test("Cancel closes it, sends no DELETE and returns focus to the trigger", async ({
      page,
      context,
    }) => {
      const { trigger, dialog, deletes } = await open(page, context);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(deletes).toEqual([]);
    });

    test("Confirm sends DELETE /api/litellm/teams/t1/members/<oid>", async ({
      page,
      context,
    }) => {
      const { dialog, deletes } = await open(page, context);
      const sent = page.waitForRequest(
        (request) =>
          request.method() === "DELETE" &&
          new URL(request.url()).pathname === REMOVE_PATH,
      );
      await dialog.getByRole("button", { name: "Confirm" }).click();
      await sent;
      await expect(dialog).toBeHidden();
      expect(deletes).toHaveLength(1);
    });
  });

  // Who + LD25: Viewer and Auditor get the standard 404, never the page.
  for (const role of ["internal-viewer", "internal-auditor"]) {
    test(`${role} gets the standard 404 on the direct URL`, async ({
      page,
      context,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      await mockApi(page);
      const response = await page.goto(
        "/dashboard/litellm/team-config?team=t1",
      );
      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole("button", { name: "Generate key" }),
      ).toHaveCount(0);
    });
  }
});
