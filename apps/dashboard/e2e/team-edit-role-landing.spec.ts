import { expect, test, type Page } from "@playwright/test";

import {
  PROBE_ROLES,
  PROBE_TEAM,
  seedRoleProbe,
  type ProbeRole,
} from "../test/fixtures/role-probe-seed";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Sources: Design System - Team page, round 3 (unit TP1): Summary (T-TP1: a
// lead sees "Linked" or "Not linked" and never the LiteLLM team id, ruling
// Q-B1) and Edit team (T-TP7: absent for a lead); Access Control - Edit a
// created team (leads may not edit: Q-R3-2). The Lead's scope lives in the
// role-probe table, so this spec is named to run in that project (PROBE_SPEC
// in playwright.config.ts); the admin and org-admin journeys are in
// team-edit.spec.ts. The fake gateway lists no LiteLLM team, so the lead's
// state reads "Not linked"; that no id ever reaches a lead is asserted on the
// props in the page test.
test.beforeAll(seedRoleProbe);

const GUILD_ID = "appteam-00000000-0000-4000-8000-000000000001";

const byName = (name: string): ProbeRole => {
  const role = PROBE_ROLES.find((r) => r.name === name);
  if (!role) throw new Error(`unknown probe role ${name}`);
  return role;
};

async function openAs(
  page: Page,
  context: Parameters<typeof signInAsTestUser>[0],
  role: ProbeRole,
  teamId: string,
  teamName: string,
) {
  await signInAsTestUser(context, { oid: role.oid, roles: role.roles });
  await page.route(/\/api\/litellm\/me(\?|$)/, (route) =>
    route.fulfill({
      json: {
        data: {
          linked: false,
          enabledOperations: [],
          teams: [{ teamId, teamName, linked: false, configurable: false }],
        },
      },
    }),
  );
  await page.goto(`/dashboard/manage/team/${teamId}`);
  await waitForHydration(page);
  await expect(page.getByRole("region", { name: "Summary" })).toBeVisible();
}

test.describe("Team summary and Edit team for a lead (T-TP1, T-TP7)", () => {
  test("a team lead reads the summary of their team and gets no Edit team button", async ({
    page,
    context,
  }) => {
    await openAs(page, context, byName("team-admin"), PROBE_TEAM, "Payments");
    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary).toContainText("Payments");
    await expect(summary).toContainText("From an AWS account");
    await expect(summary).toContainText("Not linked");
    await expect(page.getByRole("button", { name: "Edit team" })).toHaveCount(
      0,
    );
  });

  test("a department lead opens a created team of the department and gets no Edit team button", async ({
    page,
    context,
  }) => {
    await openAs(
      page,
      context,
      byName("department-admin"),
      GUILD_ID,
      "Platform Guild",
    );
    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary).toContainText("Created here");
    await expect(page.getByRole("button", { name: "Edit team" })).toHaveCount(
      0,
    );
  });
});
