import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";
import { withStoredLiteLLMConnection } from "../test/fixtures/e2e-litellm-connection";

// Sources: Design System - "The users table (unit US1, 2026-11-24; D-US1 to
// D-US5, D-US2a, D-US3a)": the People table opens the page, the search box is
// in the panel (no "Search LiteLLM users" section), Created and Last sign-in
// are UTC dates or an em dash, five sortable headers (button in the th,
// aria-sort, sort in the URL, server sort), the name links to the user page;
// Access Control - /api/identities/directory row, unit US1 (admin, org-admin
// and auditor read; a lead is 403 and the page 404); Responsive (no sideways
// scroll at 375). The directory is fulfilled from a fixture that sorts like
// the route (sort, dir, tie-break on oid; q = at most 10 matches), because the
// sort itself is proved against DynamoDB Local in the route's integration test
// (Rule 60.24a); this file proves the browser wiring: header -> URL -> request
// -> order, per role. The lead's 404 on this page runs against the real
// team-scope lead in role-landing.spec.ts with role-probe identities, so this
// file checks the no-team viewer.
type Person = {
  oid: string;
  displayName: string;
  email: string | null;
  authMethod: "entra";
  memberTeamId: string | null;
  litellm: { state: "none" };
  linkVersion: number;
  match: null;
  createdAt?: string;
  lastSignInAt: string;
};

const PEOPLE: Person[] = [
  person(
    "oid-bea",
    "Bea Brown",
    "bea@example.test",
    "2026-03-01",
    "2026-11-02",
  ),
  person(
    "oid-ann",
    "Ann Archer",
    "zed@example.test",
    "2026-01-15",
    "2026-11-20",
  ),
  person("oid-cal", "Cal Chen", "cal@example.test", undefined, "2026-10-05"),
  person("oid-dee", "Dee Hit", "dee@example.test", "2026-02-10", "2026-09-09"),
];

function person(
  oid: string,
  displayName: string,
  email: string | null,
  created: string | undefined,
  lastSignIn: string,
): Person {
  return {
    oid,
    displayName,
    email,
    authMethod: "entra",
    memberTeamId: null,
    litellm: { state: "none" },
    linkVersion: 0,
    match: null,
    ...(created ? { createdAt: `${created}T08:00:00.000Z` } : {}),
    lastSignInAt: `${lastSignIn}T08:00:00.000Z`,
  };
}

const KEY: Record<string, (p: Person) => string> & {
  name: (p: Person) => string;
} = {
  name: (p) => p.displayName.toLowerCase(),
  email: (p) => (p.email ?? "").toLowerCase(),
  createdAt: (p) => p.createdAt ?? "",
  lastSignInAt: (p) => p.lastSignInAt,
  team: (p) => p.memberTeamId ?? "",
};

function sorted(sort: string, dir: string): Person[] {
  const key = KEY[sort] ?? KEY.name;
  const sign = dir === "desc" ? -1 : 1;
  // A record with no createdAt sorts last in both directions (D-US2a).
  const missing = (p: Person) => sort === "createdAt" && !p.createdAt;
  return [...PEOPLE].sort((a, b) => {
    if (missing(a) !== missing(b)) return missing(a) ? 1 : -1;
    const order = key(a).localeCompare(key(b)) * sign;
    return order !== 0 ? order : a.oid.localeCompare(b.oid);
  });
}

async function mockDirectory(page: Page) {
  const requests: URL[] = [];
  await page.route(/\/api\/identities\/directory/, (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const q = url.searchParams.get("q")?.toLowerCase();
    const items = q
      ? PEOPLE.filter((p) =>
          `${p.displayName} ${p.email ?? ""}`.toLowerCase().includes(q),
        ).slice(0, 10)
      : sorted(
          url.searchParams.get("sort") ?? "name",
          url.searchParams.get("dir") ?? "asc",
        );
    return route.fulfill({ json: { data: { items } } });
  });
  return requests;
}

async function open(page: Page) {
  await page.goto("/dashboard/manage/users");
  await waitForHydration(page);
}

const people = (page: Page) => page.getByRole("region", { name: "People" });
const names = async (page: Page) => {
  const rows = await people(page).getByRole("row").all();
  const out: string[] = [];
  // Row 0 is the header row; the first cell of each body row is the name.
  for (const row of rows.slice(1)) {
    out.push(
      ((await row.getByRole("cell").first().textContent()) ?? "").trim(),
    );
  }
  return out;
};
const header = (page: Page, name: string | RegExp) =>
  people(page).getByRole("columnheader", { name });

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

const READERS = ["internal-admin", "internal-org-admin", "internal-auditor"];

test.describe("Management -> Users table (unit US1)", () => {
  for (const role of READERS) {
    test(`${role}: opens on the People table sorted by name, a header click sorts on the server and flips, no search section`, async ({
      context,
      page,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      const requests = await mockDirectory(page);
      await open(page);

      await expect(people(page)).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Search LiteLLM users" }),
      ).toHaveCount(0);
      await expect(header(page, "Name")).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
      await expect
        .poll(() => names(page))
        .toEqual(["Ann Archer", "Bea Brown", "Cal Chen", "Dee Hit"]);

      await header(page, "Email").getByRole("button").click();
      await expect(header(page, "Email")).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
      await expect(header(page, "Name")).toHaveAttribute("aria-sort", "none");
      await expect
        .poll(() => names(page))
        .toEqual(["Bea Brown", "Cal Chen", "Dee Hit", "Ann Archer"]);
      await expect(page).toHaveURL(/sort=email/);

      await header(page, "Email").getByRole("button").click();
      await expect(header(page, "Email")).toHaveAttribute(
        "aria-sort",
        "descending",
      );
      await expect
        .poll(() => names(page))
        .toEqual(["Ann Archer", "Dee Hit", "Cal Chen", "Bea Brown"]);
      expect(
        requests.some(
          (u) =>
            u.searchParams.get("sort") === "email" &&
            u.searchParams.get("dir") === "desc",
        ),
      ).toBe(true);
    });
  }

  test("Created and Last sign-in show UTC dates and a dash for a record with no createdAt; Created sorts it last (D-US2a)", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockDirectory(page);
    await open(page);

    const cal = people(page).getByRole("row", { name: /Cal Chen/ });
    await expect(cal).toContainText("2026-10-05");
    await expect(cal.getByRole("cell", { name: "—" }).first()).toBeVisible();
    const ann = people(page).getByRole("row", { name: /Ann Archer/ });
    await expect(ann).toContainText("2026-01-15");
    await expect(ann).toContainText("2026-11-20");

    await header(page, "Created").getByRole("button").click();
    await expect.poll(() => names(page).then((n) => n.at(-1))).toBe("Cal Chen");
    await header(page, "Created").getByRole("button").click();
    await expect(header(page, "Created")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await expect.poll(() => names(page).then((n) => n.at(-1))).toBe("Cal Chen");
  });

  for (const role of READERS) {
    test(`${role}: the panel search shows matches by name or email`, async ({
      context,
      page,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      const requests = await mockDirectory(page);
      await open(page);

      await people(page)
        .getByRole("searchbox", { name: /search/i })
        .fill("hit");
      await expect.poll(() => names(page)).toEqual(["Dee Hit"]);
      expect(requests.some((u) => u.searchParams.get("q") === "hit")).toBe(
        true,
      );
      await expect(
        people(page).getByRole("button", { name: "Load more" }),
      ).toHaveCount(0);
    });
  }

  test("the name links to the user page", async ({ context, page }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockDirectory(page);
    await open(page);

    const link = people(page).getByRole("link", { name: "Ann Archer" });
    await expect(link).toHaveAttribute(
      "href",
      /\/dashboard\/manage\/users\/oid-ann$/,
    );
    await link.click();
    await expect(page).toHaveURL(/\/dashboard\/manage\/users\/oid-ann$/);
  });

  // Design System - Users, round 3, T-UP4: the keyboard path is the link.
  test("T-UP4: the name link opens the person page from the keyboard (Enter)", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockDirectory(page);
    await open(page);

    const link = people(page).getByRole("link", { name: "Ann Archer" });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/dashboard\/manage\/users\/oid-ann$/);
  });

  for (const [role, shown] of [
    ["internal-admin", true],
    ["internal-org-admin", true],
    ["internal-auditor", false],
  ] as const) {
    test(`${role}: the Add user button is ${shown ? "shown" : "absent"} (Access Control - /api/identities/directory, unit US1)`, async ({
      context,
      page,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      await mockDirectory(page);
      await open(page);
      await expect(people(page).getByText("Ann Archer")).toBeVisible();
      await expect(
        people(page).getByRole("button", { name: "Add user" }),
      ).toHaveCount(shown ? 1 : 0);
    });
  }

  test("a caller with no team and no global role gets the 404 (a lead's own 404 runs in role-landing.spec.ts)", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    const response = await page.goto("/dashboard/manage/users");
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/this page could not be found/i)).toBeVisible();
  });

  test("axe is clean and nothing scrolls sideways at 375px with the search results open", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockDirectory(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page);
    await people(page)
      .getByRole("searchbox", { name: /search/i })
      .fill("hit");
    await expect.poll(() => names(page)).toEqual(["Dee Hit"]);

    await expectNoBlockingViolations(page);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  test("keyboard: focus the header button and press Enter to sort; aria-sort and the order follow (Design System - users table, D-US4)", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockDirectory(page);
    await open(page);
    const button = header(page, "Email").getByRole("button");
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(header(page, "Email")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await expect
      .poll(() => names(page))
      .toEqual(["Bea Brown", "Cal Chen", "Dee Hit", "Ann Archer"]);
    await page.keyboard.press("Enter");
    await expect(header(page, "Email")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  test("axe is clean and nothing scrolls sideways on the sorted table at 1440x900", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-org-admin"] });
    await mockDirectory(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await header(page, "Last sign-in").getByRole("button").click();
    await expect(header(page, "Last sign-in")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await expectNoBlockingViolations(page);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  // ---- UP1 (Design System - Users, round 3; T-UP3, T-UP4) ------------------

  test("T-UP4: a click on the row (not on a control) opens the person's page", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockDirectory(page);
    await open(page);
    await people(page)
      .getByRole("row", { name: /Ann Archer/ })
      .getByRole("cell", { name: "zed@example.test" })
      .click();
    await expect(page).toHaveURL(/\/dashboard\/manage\/users\/oid-ann$/);
  });

  for (const role of READERS) {
    test(`T-UP4: ${role} sees FieldHelp on the Sign-in and LiteLLM headers`, async ({
      context,
      page,
    }) => {
      await signInAsTestUser(context, { roles: [role] });
      await mockDirectory(page);
      await open(page);
      for (const field of ["Sign-in", "LiteLLM"]) {
        await expect(
          header(page, new RegExp(`^${field}`)).getByRole("button", {
            name: `About ${field}`,
          }),
        ).toBeVisible();
      }
    });
  }

  for (const [role, shown] of [
    ["internal-admin", true],
    ["internal-org-admin", true],
    ["internal-auditor", false],
  ] as const) {
    test(`T-UP4: ${role} ${shown ? "has" : "does not have"} 'About Sync from LiteLLM'`, async ({
      browser,
      context,
      page,
    }) => {
      // The button renders only when LiteLLM is configured (the CI table has no
      // connection), so the cases that expect it store the e2e connection under
      // the shared state lock and restore it; the auditor never has it.
      const check = async () => {
        await signInAsTestUser(context, { roles: [role] });
        await mockDirectory(page);
        await open(page);
        await expect(people(page).getByText("Ann Archer")).toBeVisible();
        await expect(
          people(page).getByRole("button", { name: "About Sync from LiteLLM" }),
        ).toHaveCount(shown ? 1 : 0);
      };
      if (shown) await withStoredLiteLLMConnection(browser, check);
      else await check();
    });
  }

  for (const width of [375, 1440]) {
    test(`T-UP3: at ${width}px a FieldHelp popover is open on the Users page with no serious axe violation, and Escape returns focus`, async ({
      context,
      page,
    }) => {
      await signInAsTestUser(context, { roles: ["internal-admin"] });
      await mockDirectory(page);
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      const help = header(page, /^Sign-in/).getByRole("button", {
        name: "About Sign-in",
      });
      await help.click();
      await expect(
        page.getByText(
          "How this person signs in: Microsoft (SSO), a password managed here, or the local developer sign-in.",
        ),
      ).toBeVisible();
      await expectNoBlockingViolations(page);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(help).toBeFocused();
    });
  }
});
