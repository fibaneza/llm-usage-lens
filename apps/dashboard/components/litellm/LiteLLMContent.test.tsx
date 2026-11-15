import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { LiteLLMContent } from "./LiteLLMContent";

// Sources: docs/specs/2026-11-10-litellm.md -- Roles and rights; Cost
// visualisation and provenance (LT8 "LiteLLM-reported"); Page and Settings;
// LD20 (UTC day buckets labelled, timestamps in Australia/Sydney with zone);
// Design System -- LiteLLM Page (sections, states); Rules 40.4, 60.12.
// Component tests assert rendering only; the routes' scoping and audit logic
// are tested with the routes (Rule 60.24a).

const SENTINEL_KEY_VALUE = "sk-SENTINEL-KEY-VALUE";

const ME_LINKED = {
  linked: true,
  spend: 12.5,
  maxBudget: 100,
  daily: [{ date: "2026-11-14", spend: 4.5 }],
  keys: [
    {
      tokenId: "tok-me",
      keyAlias: "my-key",
      models: ["claude-sonnet"],
      maxBudget: 20,
      spend: 3.25,
      expires: "2026-12-31T00:00:00Z",
      blocked: false,
      key: SENTINEL_KEY_VALUE,
    },
  ],
  enabledOperations: [],
  teams: [],
};

const TEAM_LINKED = { teamId: "t1", teamName: "Payments", linked: true };

const TEAM_DETAIL = {
  connected: true,
  team: {
    alias: "Payments",
    spend: 321.75,
    maxBudget: 500,
    softBudget: 400,
    budgetDuration: "30d",
    models: ["claude-sonnet", "claude-haiku"],
    rpmLimit: null,
    tpmLimit: null,
  },
  daily: [{ date: "2026-11-14", spend: 40 }],
  enabledOperations: [],
};

const MEMBERS = {
  connected: true,
  items: [
    {
      oid: "oid-ada",
      name: "Ada Lovelace",
      email: "ada@example.test",
      spend: 77.1,
      maxBudget: 150,
      rpmLimit: 30,
      tpmLimit: 20000,
    },
  ],
};

const KEYS = {
  connected: true,
  items: [
    {
      tokenId: "tok-1",
      keyAlias: "ci-key",
      models: ["claude-haiku"],
      maxBudget: 50,
      spend: 8.4,
      expires: "2026-12-01T13:00:00Z",
      blocked: true,
      key: SENTINEL_KEY_VALUE,
    },
  ],
};

const AUDIT = {
  items: [
    {
      id: "a1",
      updatedAt: "2026-11-15T13:00:00Z",
      changedBy: "llm-usage-lens:lead@example.test",
      action: "update",
      tableName: "LiteLLM_TeamTable",
      objectId: "t1",
      changedFields: ["max_budget"],
      viaDashboard: true,
    },
    {
      id: "a2",
      updatedAt: "2026-11-15T14:00:00Z",
      changedBy: "ops@example.test",
      action: "create",
      tableName: "LiteLLM_VerificationToken",
      objectId: "tok-9",
      changedFields: ["models"],
      viaDashboard: false,
    },
  ],
};

type Routes = Record<string, () => Response>;

function stub(routes: Routes) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      calls.push(path);
      const route = routes[path];
      if (!route) throw new Error(`unexpected ${path}`);
      return Promise.resolve(route());
    }),
  );
  return calls;
}

const ok = (data: unknown) => () => apiResponse({ data });
const unavailable = () =>
  apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable");

function teamRoutes(overrides: Routes = {}): Routes {
  return {
    "/api/litellm/me": ok({ ...ME_LINKED, teams: [TEAM_LINKED] }),
    "/api/litellm/teams/t1": ok(TEAM_DETAIL),
    "/api/litellm/teams/t1/members": ok(MEMBERS),
    "/api/litellm/teams/t1/keys": ok(KEYS),
    "/api/litellm/audit": ok(AUDIT),
    ...overrides,
  };
}

const region = (name: string) => screen.findByRole("region", { name });

beforeEach(() => {
  // React logs caught render errors; keep output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LiteLLMContent sections (Page and Settings)", () => {
  it("renders every section for an Admin or Auditor with a linked team", async () => {
    stub(teamRoutes());
    renderWithProviders(<LiteLLMContent canViewAudit />);
    for (const name of [
      "My usage",
      "Team spend & budgets",
      "Members",
      "Keys",
      "Model access",
      "LiteLLM audit",
    ]) {
      expect(await region(name)).toBeInTheDocument();
    }
  });

  it("shows only My usage to a Viewer and never calls team or audit routes", async () => {
    const calls = stub({ "/api/litellm/me": ok(ME_LINKED) });
    renderWithProviders(<LiteLLMContent canViewAudit={false} />);
    expect(await region("My usage")).toBeInTheDocument();
    for (const name of [
      "Team spend & budgets",
      "Members",
      "Keys",
      "Model access",
      "LiteLLM audit",
    ]) {
      expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
    }
    expect(calls.every((p) => p === "/api/litellm/me")).toBe(true);
  });

  it("hides LiteLLM audit and skips its route for a Lead (not Admin/Auditor)", async () => {
    const calls = stub(teamRoutes());
    renderWithProviders(<LiteLLMContent canViewAudit={false} />);
    expect(await region("Members")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "LiteLLM audit" }),
    ).not.toBeInTheDocument();
    expect(calls).not.toContain("/api/litellm/audit");
  });

  it("switches the team sections to the team picked in the Team selector", async () => {
    stub(
      teamRoutes({
        "/api/litellm/me": ok({
          ...ME_LINKED,
          teams: [
            TEAM_LINKED,
            { teamId: "t2", teamName: "Search", linked: true },
          ],
        }),
        "/api/litellm/teams/t2": ok({
          ...TEAM_DETAIL,
          team: { ...TEAM_DETAIL.team, alias: "Search", spend: 9.99 },
        }),
        "/api/litellm/teams/t2/members": ok({ connected: true, items: [] }),
        "/api/litellm/teams/t2/keys": ok({ connected: true, items: [] }),
      }),
    );
    renderWithProviders(<LiteLLMContent canViewAudit={false} />);
    await userEvent.selectOptions(
      await screen.findByLabelText("Team"),
      "Search",
    );
    expect(
      within(await region("Team spend & budgets")).getByText("$9.99"),
    ).toBeInTheDocument();
  });
});

describe("LiteLLMContent LiteLLM-reported labels (LT8) and USD", () => {
  it("labels the spend in My usage, Team spend, Members and Keys as LiteLLM-reported", async () => {
    stub(teamRoutes());
    renderWithProviders(<LiteLLMContent canViewAudit />);
    for (const name of [
      "My usage",
      "Team spend & budgets",
      "Members",
      "Keys",
    ]) {
      expect(
        within(await region(name)).getAllByText("LiteLLM-reported").length,
      ).toBeGreaterThan(0);
    }
  });

  it("renders spend and budgets in USD", async () => {
    stub(teamRoutes());
    renderWithProviders(<LiteLLMContent canViewAudit />);
    const mine = await region("My usage");
    expect(within(mine).getByText("$12.50")).toBeInTheDocument();
    expect(within(mine).getByText("$100.00")).toBeInTheDocument();
    const team = await region("Team spend & budgets");
    expect(within(team).getByText("$321.75")).toBeInTheDocument();
    expect(within(team).getByText("$500.00")).toBeInTheDocument();
    expect(within(team).getByText("$400.00")).toBeInTheDocument();
    expect(
      within(await region("Members")).getByText("$77.10"),
    ).toBeInTheDocument();
  });
});

describe("LiteLLMContent time rendering (LD20)", () => {
  it("labels daily buckets as UTC days", async () => {
    stub(teamRoutes());
    renderWithProviders(<LiteLLMContent canViewAudit />);
    expect(
      within(await region("Team spend & budgets")).getByText(/UTC days?/i),
    ).toBeInTheDocument();
    expect(
      within(await region("My usage")).getByText(/UTC days?/i),
    ).toBeInTheDocument();
  });

  it("renders key expiry in Australia/Sydney with the zone label", async () => {
    stub(teamRoutes());
    renderWithProviders(<LiteLLMContent canViewAudit />);
    // 2026-12-01T13:00:00Z is 2026-12-02 00:00 in AEDT.
    expect(
      within(await region("Keys")).getByText(/2 Dec 2026,? 00:00 AEDT/),
    ).toBeInTheDocument();
  });

  it("renders audit timestamps in Australia/Sydney with the zone label", async () => {
    stub(teamRoutes());
    renderWithProviders(<LiteLLMContent canViewAudit />);
    expect(
      within(await region("LiteLLM audit")).getByText(
        /16 Nov 2026,? 00:00 AEDT/,
      ),
    ).toBeInTheDocument();
  });
});

describe("LiteLLMContent Keys (metadata only)", () => {
  it("shows alias, models, spend, expiry and blocked state, never a key value", async () => {
    stub(teamRoutes());
    const { container } = renderWithProviders(<LiteLLMContent canViewAudit />);
    const keys = await region("Keys");
    expect(within(keys).getByText("ci-key")).toBeInTheDocument();
    expect(within(keys).getByText("claude-haiku")).toBeInTheDocument();
    expect(within(keys).getByText("$8.40")).toBeInTheDocument();
    expect(within(keys).getByText(/blocked/i)).toBeInTheDocument();
    await region("My usage");
    expect(container.textContent).not.toContain(SENTINEL_KEY_VALUE);
  });

  it("lists the viewer's own keys' metadata in My usage", async () => {
    stub({ "/api/litellm/me": ok(ME_LINKED) });
    renderWithProviders(<LiteLLMContent canViewAudit={false} />);
    expect(
      within(await region("My usage")).getByText("my-key"),
    ).toBeInTheDocument();
  });
});

describe("LiteLLMContent Model access and Members", () => {
  it("lists the team's models read-only", async () => {
    stub(teamRoutes());
    renderWithProviders(<LiteLLMContent canViewAudit />);
    const models = await region("Model access");
    expect(within(models).getByText("claude-sonnet")).toBeInTheDocument();
    expect(within(models).getByText("claude-haiku")).toBeInTheDocument();
    expect(within(models).queryAllByRole("button")).toHaveLength(0);
    expect(within(models).queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("shows each member's name, budget and limits (read views carry no write controls in L3)", async () => {
    stub(teamRoutes());
    renderWithProviders(<LiteLLMContent canViewAudit />);
    const members = await region("Members");
    expect(within(members).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(members).getByText("$150.00")).toBeInTheDocument();
    expect(within(members).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("LiteLLMContent LiteLLM audit (LD15, LT20)", () => {
  it("shows time, actor, action, object and changed field names, with via dashboard on dashboard entries only", async () => {
    stub(teamRoutes());
    renderWithProviders(<LiteLLMContent canViewAudit />);
    const audit = await region("LiteLLM audit");
    expect(within(audit).getByText("ops@example.test")).toBeInTheDocument();
    expect(within(audit).getByText("max_budget")).toBeInTheDocument();
    expect(within(audit).getByText("tok-9")).toBeInTheDocument();
    expect(within(audit).getAllByText(/via dashboard/i)).toHaveLength(1);
  });
});

describe("LiteLLMContent states", () => {
  it("shows 'not connected to LiteLLM' for an unlinked team without calling its routes", async () => {
    const calls = stub({
      "/api/litellm/me": ok({
        ...ME_LINKED,
        teams: [{ teamId: "t1", teamName: "Payments", linked: false }],
      }),
    });
    renderWithProviders(<LiteLLMContent canViewAudit={false} />);
    const team = await region("Team spend & budgets");
    expect(
      within(team).getByText(/not connected to LiteLLM/i),
    ).toBeInTheDocument();
    expect(calls.some((p) => p.startsWith("/api/litellm/teams/"))).toBe(false);
  });

  it("shows an EmptyState for an unlinked Viewer", async () => {
    stub({
      "/api/litellm/me": ok({
        linked: false,
        spend: 0,
        maxBudget: null,
        daily: [],
        keys: [],
        enabledOperations: [],
        teams: [],
      }),
    });
    renderWithProviders(<LiteLLMContent canViewAudit={false} />);
    expect(
      within(await region("My usage")).getByText(/not linked to LiteLLM/i),
    ).toBeInTheDocument();
  });

  it("shows an inline 'LiteLLM unavailable' on an outage and keeps the page and other sections up", async () => {
    stub(
      teamRoutes({
        "/api/litellm/me": unavailable,
        "/api/litellm/audit": ok(AUDIT),
      }),
    );
    renderWithProviders(<LiteLLMContent canViewAudit />);
    expect(
      within(await region("My usage")).getByText(/LiteLLM unavailable/i),
    ).toBeInTheDocument();
    expect(
      within(await region("LiteLLM audit")).getByText("ops@example.test"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });

  it("shows 'LiteLLM unavailable' in each team section when the team routes return 503", async () => {
    stub(
      teamRoutes({
        "/api/litellm/teams/t1": unavailable,
        "/api/litellm/teams/t1/members": unavailable,
        "/api/litellm/teams/t1/keys": unavailable,
      }),
    );
    renderWithProviders(<LiteLLMContent canViewAudit />);
    for (const name of ["Team spend & budgets", "Members", "Keys"]) {
      expect(
        within(await region(name)).getByText(/LiteLLM unavailable/i),
      ).toBeInTheDocument();
    }
    expect(
      within(await region("My usage")).getByText("$12.50"),
    ).toBeInTheDocument();
  });

  it("isolates a failing section: a 500 on Members leaves Keys and the rest rendering (Rule 40.4)", async () => {
    stub(
      teamRoutes({
        "/api/litellm/teams/t1/members": () => apiError(500),
      }),
    );
    renderWithProviders(<LiteLLMContent canViewAudit />);
    expect(
      await within(await region("Members")).findByRole("alert"),
    ).toHaveTextContent(/couldn't load/i);
    expect(
      within(await region("Keys")).getByText("ci-key"),
    ).toBeInTheDocument();
    expect(
      within(await region("My usage")).getByText("$12.50"),
    ).toBeInTheDocument();
  });
});
