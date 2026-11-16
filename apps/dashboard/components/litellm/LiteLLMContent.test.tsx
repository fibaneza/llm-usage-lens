import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { LiteLLMContent } from "./LiteLLMContent";

// Sources: docs/specs/2026-11-10-litellm.md -- Roles and rights; Cost
// visualisation and provenance (LT8 "LiteLLM-reported"); Page and Settings;
// LD20 (UTC day buckets labelled, timestamps in Australia/Sydney with zone);
// Design System -- LiteLLM Page (sections, states); Rules 40.4, 60.12.
// L3b (Views by role): the sections are grouped into tabs -- My usage (my-usage),
// Team (team), Organisation (organisation), Users (users), Audit (audit). The
// server passes `tabs` (the allowed ids); `?tab=` (nuqs) selects one. Existing
// cases are unchanged in behaviour; each now opens the tab holding its section.
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
      userId: "u-ada",
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

type TabId = "my-usage" | "team" | "organisation" | "users" | "audit";
const ALL: TabId[] = ["my-usage", "team", "organisation", "users", "audit"];
const NO_AUDIT: TabId[] = ["my-usage", "team", "organisation", "users"];
const TAB_NAME: Record<TabId, string> = {
  "my-usage": "My usage",
  team: "Team",
  organisation: "Organisation",
  users: "Users",
  audit: "Audit",
};

function renderPage(tabs: TabId[], tab?: TabId) {
  return renderWithProviders(<LiteLLMContent tabs={tabs} />, {
    searchParams: tab ? { tab } : {},
  });
}
async function openTab(tab: TabId) {
  await userEvent.click(
    await screen.findByRole("tab", { name: TAB_NAME[tab] }),
  );
}

beforeEach(() => {
  // React logs caught render errors; keep output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LiteLLMContent tabs (Views by role, L3b)", () => {
  it("renders exactly the tabs the server allows, My usage selected by default (Views by role)", async () => {
    stub(teamRoutes());
    renderPage(ALL);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "My usage",
      "Team",
      "Organisation",
      "Users",
      "Audit",
    ]);
    expect(screen.getByRole("tab", { name: "My usage" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("does not render a tab the caller cannot use, and never calls its routes (Views by role)", async () => {
    const calls = stub(teamRoutes());
    renderPage(["my-usage"]);
    await region("My usage");
    for (const name of ["Team", "Organisation", "Users", "Audit"]) {
      expect(screen.queryByRole("tab", { name })).not.toBeInTheDocument();
    }
    expect(calls.every((p) => p === "/api/litellm/me")).toBe(true);
  });

  it("shows the Team tab only when me.teams is non-empty (Views by role: Team)", async () => {
    stub({ "/api/litellm/me": ok({ ...ME_LINKED, teams: [] }) });
    renderPage(["my-usage", "team", "users"]);
    await region("My usage");
    await screen.findByRole("tab", { name: "Users" });
    expect(screen.queryByRole("tab", { name: "Team" })).not.toBeInTheDocument();
  });

  it("the allowed-tabs prop is a ceiling: teams alone do not add a Team tab (Views by role)", async () => {
    stub(teamRoutes());
    renderPage(["my-usage"]);
    await region("My usage");
    expect(screen.queryByRole("tab", { name: "Team" })).not.toBeInTheDocument();
  });

  it("?tab= selects an allowed tab (Rule 40.5 URL state)", async () => {
    stub(teamRoutes());
    renderPage(ALL, "audit");
    expect(await region("LiteLLM audit")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Audit" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it.each(["audit", "bogus"])(
    "?tab=%s falls back to My usage when it is not allowed or unknown (Views by role)",
    async (tab) => {
      stub(teamRoutes());
      renderWithProviders(<LiteLLMContent tabs={["my-usage"]} />, {
        searchParams: { tab },
      });
      expect(await region("My usage")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "My usage" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    },
  );

  it("choosing a tab writes ?tab= (Rule 40.5)", async () => {
    stub(teamRoutes());
    const onUrlUpdate = vi.fn();
    renderWithProviders(<LiteLLMContent tabs={ALL} />, { onUrlUpdate });
    await openTab("organisation");
    expect(onUrlUpdate).toHaveBeenCalled();
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("tab")).toBe(
      "organisation",
    );
  });

  it("only the selected tab's sections request data (Design System -- LiteLLM Page: sections keep Suspense per tab)", async () => {
    const calls = stub(teamRoutes());
    renderPage(ALL);
    await region("My usage");
    expect(calls).not.toContain("/api/litellm/audit");
    expect(calls).not.toContain("/api/litellm/org");
  });
});

describe("LiteLLMContent sections (Page and Settings)", () => {
  it("renders every section for an Admin or Auditor with a linked team", async () => {
    stub(teamRoutes());
    renderPage(ALL);
    expect(await region("My usage")).toBeInTheDocument();
    await openTab("team");
    for (const name of [
      "Team spend & budgets",
      "Members",
      "Keys",
      "Model access",
    ]) {
      expect(await region(name)).toBeInTheDocument();
    }
    await openTab("audit");
    expect(await region("LiteLLM audit")).toBeInTheDocument();
  });

  it("shows only My usage to a Viewer and never calls team or audit routes", async () => {
    const calls = stub({ "/api/litellm/me": ok(ME_LINKED) });
    renderPage(["my-usage"]);
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
    renderPage(["my-usage", "team", "users"], "team");
    expect(await region("Members")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "LiteLLM audit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Audit" }),
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
    renderPage(NO_AUDIT, "team");
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
    renderPage(ALL);
    expect(
      within(await region("My usage")).getAllByText("LiteLLM-reported").length,
    ).toBeGreaterThan(0);
    await openTab("team");
    for (const name of ["Team spend & budgets", "Members", "Keys"]) {
      expect(
        within(await region(name)).getAllByText("LiteLLM-reported").length,
      ).toBeGreaterThan(0);
    }
  });

  it("renders spend and budgets in USD", async () => {
    stub(teamRoutes());
    renderPage(ALL);
    const mine = await region("My usage");
    expect(within(mine).getByText("$12.50")).toBeInTheDocument();
    expect(within(mine).getByText("$100.00")).toBeInTheDocument();
    await openTab("team");
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
    renderPage(ALL);
    expect(
      within(await region("My usage")).getByText(/UTC days?/i),
    ).toBeInTheDocument();
    await openTab("team");
    expect(
      within(await region("Team spend & budgets")).getByText(/UTC days?/i),
    ).toBeInTheDocument();
  });

  it("renders key expiry in Australia/Sydney with the zone label", async () => {
    stub(teamRoutes());
    renderPage(ALL, "team");
    // 2026-12-01T13:00:00Z is 2026-12-02 00:00 in AEDT.
    expect(
      within(await region("Keys")).getByText(/2 Dec 2026,? 00:00 AEDT/),
    ).toBeInTheDocument();
  });

  it("renders audit timestamps in Australia/Sydney with the zone label", async () => {
    stub(teamRoutes());
    renderPage(ALL, "audit");
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
    const { container } = renderPage(ALL, "team");
    const keys = await region("Keys");
    expect(within(keys).getByText("ci-key")).toBeInTheDocument();
    expect(within(keys).getByText("claude-haiku")).toBeInTheDocument();
    expect(within(keys).getByText("$8.40")).toBeInTheDocument();
    expect(within(keys).getByText(/blocked/i)).toBeInTheDocument();
    expect(container.textContent).not.toContain(SENTINEL_KEY_VALUE);
    await openTab("my-usage");
    await region("My usage");
    expect(container.textContent).not.toContain(SENTINEL_KEY_VALUE);
  });

  it("lists the viewer's own keys' metadata in My usage", async () => {
    stub({ "/api/litellm/me": ok(ME_LINKED) });
    renderPage(["my-usage"]);
    expect(
      within(await region("My usage")).getByText("my-key"),
    ).toBeInTheDocument();
  });

  it("a Lead who is also a LiteLLM user sees their own usage on My usage (Views by role: My usage)", async () => {
    stub(teamRoutes());
    renderPage(["my-usage", "team", "users"]);
    const mine = await region("My usage");
    expect(within(mine).getByText("$12.50")).toBeInTheDocument();
    expect(within(mine).getByText("my-key")).toBeInTheDocument();
  });
});

describe("LiteLLMContent Model access and Members", () => {
  it("lists the team's models read-only", async () => {
    stub(teamRoutes());
    renderPage(ALL, "team");
    const models = await region("Model access");
    expect(within(models).getByText("claude-sonnet")).toBeInTheDocument();
    expect(within(models).getByText("claude-haiku")).toBeInTheDocument();
    expect(within(models).queryAllByRole("button")).toHaveLength(0);
    expect(within(models).queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("shows each member's name, budget and limits (read views carry no write controls in L3)", async () => {
    stub(teamRoutes());
    renderPage(ALL, "team");
    const members = await region("Members");
    expect(within(members).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(members).getByText("$150.00")).toBeInTheDocument();
    expect(within(members).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("LiteLLMContent LiteLLM audit (LD15, LT20)", () => {
  it("shows time, actor, action, object and changed field names, with via dashboard on dashboard entries only", async () => {
    stub(teamRoutes());
    renderPage(ALL, "audit");
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
    renderPage(NO_AUDIT, "team");
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
    renderPage(["my-usage"]);
    expect(
      within(await region("My usage")).getByText(/not linked to LiteLLM/i),
    ).toBeInTheDocument();
  });

  it("shows an inline 'LiteLLM unavailable' on an outage and keeps the page and other tabs up", async () => {
    stub(teamRoutes({ "/api/litellm/me": unavailable }));
    renderPage(ALL);
    expect(
      within(await region("My usage")).getByText(/LiteLLM unavailable/i),
    ).toBeInTheDocument();
    await openTab("audit");
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
    renderPage(ALL, "team");
    for (const name of ["Team spend & budgets", "Members", "Keys"]) {
      expect(
        within(await region(name)).getByText(/LiteLLM unavailable/i),
      ).toBeInTheDocument();
    }
    await openTab("my-usage");
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
    renderPage(ALL, "team");
    expect(
      await within(await region("Members")).findByRole("alert"),
    ).toHaveTextContent(/couldn't load/i);
    expect(
      within(await region("Keys")).getByText("ci-key"),
    ).toBeInTheDocument();
    await openTab("my-usage");
    expect(
      within(await region("My usage")).getByText("$12.50"),
    ).toBeInTheDocument();
  });
});

// Organisation and Users tabs: wiring only; the section behaviour is tested in
// OrganisationSection.test.tsx and UserSearch.test.tsx (Rule 60.24a).
describe("LiteLLMContent Organisation and Users tabs (Views by role)", () => {
  it("the Organisation tab holds an 'Organisation' region and the Users tab a 'Users' region, each its own boundary", async () => {
    stub(
      teamRoutes({
        "/api/litellm/org": () => apiError(500),
      }),
    );
    renderPage(ALL, "organisation");
    expect(
      await within(await region("Organisation")).findByRole("alert"),
    ).toHaveTextContent(/couldn't load/i);
    await openTab("users");
    expect(await region("Users")).toBeInTheDocument();
    expect(
      within(await region("Users")).getByRole("searchbox", {
        name: /search users/i,
      }),
    ).toBeInTheDocument();
  });
});

// B4: /api/litellm/me parses DateRangeQuerySchema (Rule 20.8), so every
// caller must send the page's UTC range -- the URL range when set, else the
// app default (Rule 20.1; lib/date-range defaultDateRange).
describe("LiteLLMContent /api/litellm/me date range (B4)", () => {
  function captureMeQueries() {
    const queries: URLSearchParams[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/api/litellm/me") queries.push(url.searchParams);
        const route = teamRoutes()[url.pathname];
        if (!route) throw new Error(`unexpected ${url.pathname}`);
        return Promise.resolve(route());
      }),
    );
    return queries;
  }

  it("sends the URL date range with every me request, on My usage and Team (Rule 20.8)", async () => {
    const queries = captureMeQueries();
    renderWithProviders(<LiteLLMContent tabs={ALL} />, {
      searchParams: { dateFrom: "2026-11-01", dateTo: "2026-11-14" },
    });
    await region("My usage");
    await openTab("team");
    await region("Team spend & budgets");
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q.get("dateFrom")).toBe("2026-11-01");
      expect(q.get("dateTo")).toBe("2026-11-14");
    }
  });

  it("falls back to the default 30-day UTC range when the URL has none (Rule 20.1)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));
    try {
      const queries = captureMeQueries();
      renderPage(ALL);
      await region("My usage");
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expect(q.get("dateFrom")).toBe("2026-10-16");
        expect(q.get("dateTo")).toBe("2026-11-14");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

// Source: docs/specs/2026-11-10-litellm.md -- "Team configuration page (L4)"
// (Entry point: a "Configure team" link in the Team tab, rendered only for
// callers who can open the page), LD25. Server signal: `configurable` on each
// `me.teams[]` entry (optional boolean, absent = false), computed by the me
// route from the caller's scope/role; the link targets
// /dashboard/litellm/team-config?team=<selected team id>.
describe("LiteLLMContent Configure team link (L4, LD25)", () => {
  const TEAMS = [
    { teamId: "t1", teamName: "Payments", linked: true, configurable: true },
    { teamId: "t2", teamName: "Risk", linked: true, configurable: false },
  ];
  const meWithTeams = (teams: unknown[]) => ({ ...ME_LINKED, teams });

  it("links to the team configuration page for a configurable team", async () => {
    stub(teamRoutes({ "/api/litellm/me": ok(meWithTeams(TEAMS)) }));
    renderPage(ALL, "team");
    expect(
      await screen.findByRole("link", { name: "Configure team" }),
    ).toHaveAttribute("href", "/dashboard/litellm/team-config?team=t1");
  });

  it("is absent when the selected team is not configurable, and follows the picker", async () => {
    stub(
      teamRoutes({
        "/api/litellm/me": ok(meWithTeams(TEAMS)),
        "/api/litellm/teams/t2": ok(TEAM_DETAIL),
        "/api/litellm/teams/t2/members": ok(MEMBERS),
        "/api/litellm/teams/t2/keys": ok(KEYS),
      }),
    );
    renderPage(ALL, "team");
    await screen.findByRole("link", { name: "Configure team" });
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Team" }),
      "t2",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Configure team" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("is absent for a caller whose teams carry no configurable flag (fail closed: Auditor, Viewer)", async () => {
    stub(
      teamRoutes({
        "/api/litellm/me": ok(
          meWithTeams([{ teamId: "t1", teamName: "Payments", linked: true }]),
        ),
      }),
    );
    renderPage(ALL, "team");
    await region("Members");
    expect(
      screen.queryByRole("link", { name: "Configure team" }),
    ).not.toBeInTheDocument();
  });
});
