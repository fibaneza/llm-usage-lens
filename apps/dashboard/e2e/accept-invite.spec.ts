import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";
import { mockApi, NOW } from "./support/settings-api";

// Sources: Access Control - "Accept a pending invite" (unit INV1: an admin
// binds a pending member invitation to a signed-in identity chosen from the
// candidates, with a reason, confirmed in an AlertDialog), API routes
// (.../candidates, .../accept); Design System - Management improvements
// ("Accept a pending invite"). Component and refusal cases live in
// AcceptInviteDialog.test.tsx / PendingAccessSection.test.tsx (Rule 60.24a);
// this covers the real shell once. Why mocked: the harness seeds no pending
// invite and a forged session cannot also be a signed-in candidate identity,
// and every Settings access spec fulfils /api/* from fixtures (Rule 60.24), so
// the two INV1 routes and the two lists they change are fulfilled here on top
// of mockApi (a later page.route wins).
const PEOPLE = "/dashboard/settings/access/people";
const BASE = "/api/teams/team-pay/members/pending/new.hire%40example.com";

async function mockInvite(page: Page) {
  await mockApi(page);
  let accepted: { oid: string; reason: string } | null = null;
  const posts: unknown[] = [];
  const json = (data: unknown, status = 200) => ({ status, json: { data } });
  await page.route(/\/api\/access\/pending/, (route) =>
    route.fulfill(
      json({
        items: accepted
          ? []
          : [
              {
                kind: "affiliation",
                emailOrUpn: "new.hire@example.com",
                teamId: "team-pay",
                createdBy: "oid-admin",
                createdAt: NOW,
                version: 1,
              },
            ],
      }),
    ),
  );
  await page.route(/\/api\/teams\/team-pay\/members$/, (route) =>
    route.fulfill(
      json({
        items: accepted
          ? [
              {
                oid: "oid-jane",
                displayName: "Jane Doe",
                email: "new.hire@example.com",
                teamId: "team-pay",
                source: "ui",
                version: 1,
                createdAt: NOW,
                updatedAt: NOW,
                createdBy: "oid-admin",
              },
            ]
          : [],
      }),
    ),
  );
  await page.route(`**${BASE}/candidates*`, (route) =>
    route.fulfill(
      json({
        items: [
          {
            oid: "oid-jane",
            displayName: "Jane Doe",
            upn: "new.hire_example.com#EXT#@tenant.onmicrosoft.com",
            email: "new.hire@example.com",
          },
        ],
      }),
    ),
  );
  await page.route(`**${BASE}/accept`, (route) => {
    const body = route.request().postDataJSON() as {
      oid: string;
      reason: string;
    };
    posts.push(body);
    accepted = body;
    return route.fulfill(json({ oid: body.oid, teamId: "team-pay" }));
  });
  return posts;
}

test.describe("accept a pending invite (INV1)", () => {
  test.beforeEach(async ({ context }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
  });

  test("an admin picks the candidate, gives a reason, confirms, and the person is a member", async ({
    page,
  }) => {
    const posts = await mockInvite(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PEOPLE);
    await waitForHydration(page);

    const pending = page.getByRole("region", {
      name: "Pending and stale access",
    });
    await pending
      .getByRole("button", { name: /accept.*new\.hire@example\.com/i })
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /Jane Doe/ }).check();
    await expect(dialog).toContainText(/UPN differs/i);
    await dialog.getByLabel(/reason/i).fill("Same person, guest UPN");
    await dialog.getByRole("button", { name: "Confirm" }).click();

    const alert = page.getByRole("alertdialog");
    await expect(alert).toContainText("Jane Doe");
    await expect(alert).toContainText("Payments");
    expect(posts).toEqual([]);
    await alert.getByRole("button", { name: "Add to team" }).click();

    await expect(
      pending.getByRole("row", { name: /new\.hire@example\.com/ }),
    ).toHaveCount(0);
    expect(posts).toEqual([
      { oid: "oid-jane", reason: "Same person, guest UPN" },
    ]);
    await expect(
      page
        .getByRole("region", { name: "Members" })
        .getByRole("row", { name: /Jane Doe/ }),
    ).toBeVisible();
  });

  // U-B1 (INV1 review): Design System - Layout (375 / 1440, no horizontal
  // overflow) and WCAG 2 A/AA; the dialog and the confirmation are the only
  // new surfaces and the smoke pass cannot see them.
  for (const width of [375, 1440]) {
    test(`the dialog and the confirmation at ${width}px: no serious or critical axe violation, no horizontal overflow`, async ({
      page,
    }) => {
      await mockInvite(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(PEOPLE);
      await waitForHydration(page);

      await page
        .getByRole("region", { name: "Pending and stale access" })
        .getByRole("button", { name: /accept.*new\.hire@example\.com/i })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("radio", { name: /Jane Doe/ }).check();
      await dialog.getByLabel(/reason/i).fill("Same person, guest UPN");

      const check = async () => {
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
        const overflow = await page.evaluate(() => ({
          page:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
          dialogs: [
            ...document.querySelectorAll("[role=dialog],[role=alertdialog]"),
          ]
            .map((el) => el.scrollWidth - el.clientWidth)
            .filter((d) => d > 0),
        }));
        expect(overflow.page).toBeLessThanOrEqual(0);
        expect(overflow.dialogs).toEqual([]);
      };

      await check();
      await dialog.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await check();
    });
  }
});
