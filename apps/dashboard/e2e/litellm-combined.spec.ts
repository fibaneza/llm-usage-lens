import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Where each figure appears (Overview: a "Combined usage" section with
// the parts, "Billed via LiteLLM" and the reconciliation row; My usage: a
// "Your combined usage" card above the Bedrock and LiteLLM sections), States
// ("gateway not configured — totals may double count", role="status"; hidden:
// no combined card, the source sections stay), UI pieces (parts always as
// text; reconciliation sign in words); Rule 70.12 (one targeted spec; API
// fulfilled from fixtures, Rule 60.24). Unit behaviour (all states, copy, the
// disclosure) is covered by the component tests (Rule 60.24a); this spec adds
// only what a browser shows: the real shell, mounts, and axe.
const WARNING = "gateway not configured — totals may double count";

const OVERVIEW = {
  totalCost: 1234.56,
  modelCost: 1000,
  nonModelCost: 234.56,
  inputTokens: 1_000_000,
  outputTokens: 500_000,
  invocations: 2_000,
  costFinalized: true,
  activeAccounts: 7,
  mostUsedModel: "claude-opus",
  byModel: [
    {
      model: "claude-opus",
      cost: 1000,
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      invocations: 2_000,
    },
  ],
  nonModelByCategory: [],
  dailyTrend: [
    {
      date: "2026-01-19",
      cost: 1234.56,
      modelCost: 1000,
      nonModelCost: 234.56,
      byModel: { "claude-opus": 1000 },
    },
  ],
  topDepartments: [
    { departmentId: "dept-eng", departmentName: "Engineering", cost: 800 },
  ],
};

const ORG_SHOW = {
  visibility: "show",
  configured: true,
  gatewayConfigured: true,
  bedrockExact: 15,
  gatewaySlice: 5,
  bedrockDirect: 10,
  litellm: 6.2,
  combined: 16.2,
  byProvider: [
    { provider: "bedrock", spend: 5.2 },
    { provider: "openai", spend: 1 },
  ],
  reconciliation: {
    litellmBedrock: 5.2,
    difference: -0.2,
    differencePct: -0.04,
  },
  costEstimated: false,
  provisional: false,
};
const ORG_WARN = {
  ...ORG_SHOW,
  visibility: "warn",
  gatewayConfigured: false,
  gatewaySlice: 0,
  bedrockDirect: 15,
  combined: 21.2,
  reconciliation: null,
};
const HIDDEN = {
  visibility: "hidden",
  configured: true,
  gatewayConfigured: false,
};
const PERSON_SHOW = {
  visibility: "show",
  configured: true,
  gatewayConfigured: true,
  bedrockDirect: 10,
  litellm: 5,
  litellmUser: true,
  combined: 15,
  costEstimated: true,
  provisional: false,
};

const ME = {
  oid: "e2e-user",
  email: "e2e@example.test",
  roles: ["internal-viewer"],
  usageIdentities: ["e2e@example.test"],
  global: false,
  memberTeamId: "team-a",
  memberTeamVisible: true,
  teamScopes: [],
  departmentScopes: [],
};
const ME_USAGE = {
  totals: { cost: 12.5, inputTokens: 1200, outputTokens: 300, invocations: 42 },
  daily: [
    {
      date: "2026-01-11",
      cost: 12.5,
      inputTokens: 1200,
      outputTokens: 300,
      invocations: 42,
    },
  ],
  byModel: [
    {
      model: "claude-sonnet",
      cost: 12.5,
      inputTokens: 1200,
      outputTokens: 300,
      invocations: 42,
    },
  ],
};
const LITELLM_ME = {
  linked: true,
  spend: 5,
  maxBudget: 100,
  daily: [{ date: "2026-01-12", spend: 5 }],
  keys: [],
  teams: [],
  enabledOperations: [],
};

async function mockApi(
  page: Page,
  routes: { org?: unknown; me?: unknown; roles?: string[] },
) {
  const fulfil = (body: unknown) => ({ json: { data: body } });
  await page.route(/\/api\/sync-status(\?|$)/, (r) =>
    r.fulfill(fulfil({ state: "never-synced" })),
  );
  await page.route(/\/api\/overview(\?|$)/, (r) => r.fulfill(fulfil(OVERVIEW)));
  await page.route(/\/api\/me(\?|$)/, (r) =>
    r.fulfill(fulfil({ ...ME, roles: routes.roles ?? ME.roles })),
  );
  await page.route(/\/api\/me\/usage(\?|$)/, (r) =>
    r.fulfill(fulfil(ME_USAGE)),
  );
  await page.route(/\/api\/litellm\/me(\?|$)/, (r) =>
    r.fulfill(fulfil(LITELLM_ME)),
  );
  await page.route(/\/api\/litellm\/combined\/organisation(\?|$)/, (r) =>
    r.fulfill(fulfil(routes.org ?? HIDDEN)),
  );
  await page.route(/\/api\/litellm\/combined\/me(\?|$)/, (r) =>
    r.fulfill(fulfil(routes.me ?? HIDDEN)),
  );
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await waitForHydration(page);
}

async function expectNoBlockingViolations(page: Page) {
  await expect(page).toHaveTitle(/\S/);
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

test.describe("Overview - Combined usage (L6)", () => {
  test("an Admin with the gateway configured sees combined with its parts, Billed via LiteLLM and the reconciliation, axe clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page, { org: ORG_SHOW, roles: ["internal-admin"] });
    await open(page, "/dashboard");
    const region = page.getByRole("region", { name: "Combined usage" });
    await expect(region).toContainText("$16.20");
    await expect(
      region.getByText("Direct Bedrock $10.00 · Via LiteLLM $6.20"),
    ).toBeVisible();
    await expect(region.getByText("Billed via LiteLLM $5.00")).toBeVisible();
    await expect(region).toContainText("$0.20 less billed than reported");
    await expect(region.getByRole("status")).toHaveCount(0);

    const toggle = region.getByRole("button", { name: "Provider split" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(region.getByText("openai")).toBeVisible();
    await expectNoBlockingViolations(page);
  });

  test("an Admin without the gateway sees the warning and a link to the Gateway sub-tab, axe clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await mockApi(page, { org: ORG_WARN, roles: ["internal-admin"] });
    await open(page, "/dashboard");
    const region = page.getByRole("region", { name: "Combined usage" });
    await expect(region.getByRole("status")).toHaveText(WARNING);
    await expect(
      region.getByRole("link", { name: "Configure the gateway" }),
    ).toHaveAttribute("href", "/dashboard/settings/litellm/gateway");
    await expectNoBlockingViolations(page);
  });

  test("an Auditor sees the warning without the link", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await mockApi(page, { org: ORG_WARN, roles: ["internal-auditor"] });
    await open(page, "/dashboard");
    const region = page.getByRole("region", { name: "Combined usage" });
    await expect(region.getByRole("status")).toHaveText(WARNING);
    await expect(region.getByRole("link")).toHaveCount(0);
  });
});

test.describe("My usage - Your combined usage (L6)", () => {
  test("a Viewer without the gateway has no combined card and both source sections stay, axe clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page, { me: HIDDEN });
    await open(page, "/dashboard/me");
    await expect(
      page.getByRole("heading", { name: "Your Bedrock usage" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: /litellm usage/i }),
    ).toContainText("$5.00");
    await expect(
      page.getByRole("region", { name: "Your combined usage" }),
    ).toHaveCount(0);
    await expect(page.getByText(WARNING)).toHaveCount(0);
    await expectNoBlockingViolations(page);
  });

  test("a Viewer with the gateway sees the combined card above the source sections, axe clean", async ({
    page,
    context,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-viewer"] });
    await mockApi(page, { me: PERSON_SHOW });
    await open(page, "/dashboard/me");
    const card = page.getByRole("region", { name: "Your combined usage" });
    await expect(card).toContainText("$15.00");
    await expect(
      card.getByText("Direct Bedrock $10.00 · Via LiteLLM $5.00"),
    ).toBeVisible();
    await expect(card.getByText("Includes estimates")).toBeVisible();
    const cardBox = await card.boundingBox();
    const bedrockBox = await page
      .getByRole("heading", { name: "Your Bedrock usage" })
      .boundingBox();
    expect(cardBox).not.toBeNull();
    expect(bedrockBox).not.toBeNull();
    expect(cardBox?.y ?? 0).toBeLessThan(bedrockBox?.y ?? 0);
    await expectNoBlockingViolations(page);
  });
});

// The Teams "Combined with LiteLLM" panel left Cost by team in unit M5 (M5-D2,
// Design System - Source panels): the page is covered by usage-source-panels.spec.ts.
