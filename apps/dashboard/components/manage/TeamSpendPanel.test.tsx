import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamSpendPanel } from "./TeamSpendPanel";

// Sources: App Teams spec - Spend source and UI (linked team: the LiteLLM team
// figure, the budgets, the BudgetBar, and the member sum as a second figure
// only when the server returned one; unlinked team: the "Sum of members"
// badge, the coverage line, the member table, the one-line explanation) and
// AT6 / LiteLLM LT28 (include=memberSum is requested only for a global
// reader; the server also ignores it for a Lead); LiteLLM spec - LD20 (UTC
// days), LD36 ("Spend" is the range sum, the budget-period spend sits beside
// the budget), LD37 (not configured), Member sum step 4 (an unmatched member
// is "not in LiteLLM", never $0); Access Control - MI-D7; Design System -
// Management pages, Team usage (the panel's look is unchanged by the move);
// Rule 60.24a. The figure assertions are ported from the old
// TeamPageContent spend cases ("the linked and unlinked figures equal what the
// panel showed", unit M2 Verify). The response schema and who may get a member
// sum are tested with the route.
const RANGE = { dateFrom: "2026-10-16", dateTo: "2026-11-14" };

const MEMBER_SUM = {
  total: 4,
  daily: [
    { date: "2026-11-02", spend: 2 },
    { date: "2026-11-03", spend: 2 },
  ],
  coverage: { members: 3, matched: 2, unmatched: 1, pending: 1 },
  members: [
    { oid: "oid-u1", name: "Una One", matched: true, spend: 3.5 },
    { oid: "oid-u2", name: "Dos Two", matched: true, spend: 0.5 },
    { oid: "oid-u3", name: "Tres Three", matched: false },
  ],
};

const LINKED = {
  connected: true,
  spendSource: "litellm-team",
  team: {
    alias: "Payments",
    spend: 321.75,
    maxBudget: 500,
    softBudget: 400,
    budgetDuration: "30d",
    models: ["claude-sonnet", "claude-haiku"],
    rpmLimit: 100,
    tpmLimit: 20000,
  },
  daily: [],
  enabledOperations: [],
};

const UNLINKED = {
  connected: false,
  spendSource: "member-sum",
  daily: MEMBER_SUM.daily,
  memberSum: MEMBER_SUM,
};

type Handler = () => Response;
const okData = (data: unknown) => () => apiResponse({ data });

// Stubbed same-origin fetch (Rule 60.24: no network); records every URL.
function stub(handler: Handler) {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      urls.push(new URL(String(input), "http://localhost"));
      return handler();
    }),
  );
  return { urls };
}

function renderPanel(includeMemberSum = false) {
  return renderWithProviders(
    <TeamSpendPanel teamId="t1" includeMemberSum={includeMemberSum} />,
    { searchParams: RANGE },
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TeamSpendPanel request (App Teams - AT6; LiteLLM - LT28)", () => {
  it("includeMemberSum false: reads the team for the URL range and sends no include parameter (a Lead never asks, LT28)", async () => {
    const api = stub(okData(LINKED));
    renderPanel(false);
    await screen.findByText("LiteLLM team");

    expect(api.urls).toHaveLength(1);
    const [url] = api.urls;
    expect(url?.pathname).toBe("/api/litellm/teams/t1");
    expect(url?.searchParams.get("dateFrom")).toBe(RANGE.dateFrom);
    expect(url?.searchParams.get("dateTo")).toBe(RANGE.dateTo);
    expect(url?.searchParams.has("include")).toBe(false);
    expect(url?.search).not.toContain("memberSum");
  });

  it("includeMemberSum true (a global reader): the same read carries include=memberSum", async () => {
    const api = stub(okData(LINKED));
    renderPanel(true);
    await screen.findByText("LiteLLM team");

    expect(api.urls).toHaveLength(1);
    expect(api.urls[0]?.pathname).toBe("/api/litellm/teams/t1");
    expect(api.urls[0]?.searchParams.get("include")).toBe("memberSum");
  });
});

describe("TeamSpendPanel linked team (App Teams - Spend source, UI; LD20, LD36)", () => {
  it("shows the 'LiteLLM team' badge, the budget, the soft budget, the budget-period spend, the reset period and a neutral BudgetBar at 64%", async () => {
    stub(okData(LINKED));
    renderPanel();

    expect(await screen.findByText("LiteLLM team")).toBeInTheDocument();
    expect(screen.getByText("$500.00")).toBeInTheDocument();
    expect(screen.getByText("$400.00")).toBeInTheDocument();
    expect(screen.getByText("$321.75")).toBeInTheDocument();
    expect(screen.getByText("Resets every 30d")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "data-state",
      "neutral",
    );
    expect(screen.getByText("64%")).toBeInTheDocument();
  });

  it("shows 'No limit' for a team with no budget", async () => {
    stub(
      okData({
        ...LINKED,
        team: { ...LINKED.team, maxBudget: null, softBudget: null },
      }),
    );
    renderPanel();
    await screen.findByText("LiteLLM team");

    for (const name of ["Budget", "Soft budget"]) {
      expect(
        within(screen.getByRole("group", { name })).getByText("No limit"),
      ).toBeInTheDocument();
    }
  });

  // LD36: "Spend" is the selected range (sum of the daily rows); the
  // budget-period spend shows only beside the budget.
  it("the 'Spend' figure is the sum of the daily rows; the budget-period spend appears only as 'Spent this budget period' (LD36)", async () => {
    stub(
      okData({
        ...LINKED,
        daily: [
          { date: "2026-11-02", spend: 1.5 },
          { date: "2026-11-03", spend: 2 },
        ],
      }),
    );
    renderPanel();

    const card = await screen.findByRole("group", { name: "Spend" });
    expect(within(card).getByText("$3.50")).toBeInTheDocument();
    expect(card.textContent).not.toContain("$321.75");
    expect(screen.getByText("Spent this budget period")).toBeInTheDocument();
    expect(screen.getByText("$321.75")).toBeInTheDocument();
  });

  it("lists the daily spend by UTC day (LD20)", async () => {
    stub(okData({ ...LINKED, daily: [{ date: "2026-11-14", spend: 40 }] }));
    renderPanel();

    expect(await screen.findByText("2026-11-14")).toBeInTheDocument();
    expect(screen.getByText("Daily spend by UTC day")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /2026-11-14/ });
    expect(within(row).getByText("$40.00")).toBeInTheDocument();
  });

  // Design System - Layout, Key-value lists: a label and its value are a term
  // and its definition.
  it("pairs 'Spent this budget period' with its figure as a term and a definition", async () => {
    stub(okData(LINKED));
    renderPanel();

    const term = await screen.findByText("Spent this budget period");
    expect(term.tagName).toBe("DT");
    expect(term.nextElementSibling?.tagName).toBe("DD");
    expect(term.nextElementSibling).toHaveTextContent("$321.75");
  });

  it("without a member sum in the response (a Lead, or not asked): no second figure and no 'figures differ' text (LT28)", async () => {
    stub(okData(LINKED));
    renderPanel();
    await screen.findByText("LiteLLM team");

    expect(screen.queryByText("Sum of members")).toBeNull();
    expect(screen.queryByText(/figures? differ/i)).toBeNull();
    expect(screen.queryByText(/spent through that LiteLLM team/i)).toBeNull();
  });

  it("with a member sum in the response (a global reader): a second figure 'Sum of members' beside the team figure, its coverage and the 'Why the figures differ' text", async () => {
    stub(
      okData({
        ...LINKED,
        memberSum: { ...MEMBER_SUM, total: 2.25, daily: [] },
      }),
    );
    renderPanel(true);

    expect(await screen.findByText("LiteLLM team")).toBeInTheDocument();
    const card = screen.getByRole("group", { name: "Sum of members" });
    expect(within(card).getByText("$2.25")).toBeInTheDocument();
    expect(
      within(card).getByText(
        "3 members: 2 matched, 1 not in LiteLLM, 1 pending",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("$321.75")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/spent through that LiteLLM team's keys/i);
    expect(text).toMatch(/each app member spent through the gateway/i);
    expect(text).toMatch(/personal keys/i);
  });
});

describe("TeamSpendPanel unlinked team (App Teams - Spend source, UI; Member sum step 4, AT3)", () => {
  it("shows the member sum as the headline with the 'Sum of members' badge, the explanation and the daily rows", async () => {
    stub(okData(UNLINKED));
    renderPanel();

    expect(await screen.findByText("Sum of members")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Spend" })).getByText("$4.00"),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-11-02")).toBeInTheDocument();
    expect(screen.getByText("2026-11-03")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This team has no LiteLLM team of its own. Budgets, limits and keys are managed in LiteLLM.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("LiteLLM team")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("states the coverage: members, matched, not in LiteLLM and pending", async () => {
    stub(okData(UNLINKED));
    renderPanel();

    const line = await screen.findByText(/2 matched/);
    for (const part of [/3 members/, /1 not in LiteLLM/, /1 pending/]) {
      expect(line.textContent).toMatch(part);
    }
  });

  it("lists each member with spend; an unmatched member reads 'not in LiteLLM', never $0", async () => {
    stub(okData(UNLINKED));
    renderPanel();

    const una = await screen.findByRole("row", { name: /Una One/ });
    expect(within(una).getByText("$3.50")).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /Dos Two/ })).getByText("$0.50"),
    ).toBeInTheDocument();
    const lost = screen.getByRole("row", { name: /Tres Three/ });
    expect(within(lost).getByText(/not in LiteLLM/i)).toBeInTheDocument();
    expect(lost.textContent).not.toContain("$");
  });

  it("shows no per-member spend while the Organisation cap omits it, but still the total (AT3, LD23)", async () => {
    stub(
      okData({
        ...UNLINKED,
        memberSum: {
          ...MEMBER_SUM,
          members: MEMBER_SUM.members.map(({ oid, name, matched }) => ({
            oid,
            name,
            matched,
          })),
        },
      }),
    );
    renderPanel();

    expect(
      within(await screen.findByRole("group", { name: "Spend" })).getByText(
        "$4.00",
      ),
    ).toBeInTheDocument();
    const una = screen.getByRole("row", { name: /Una One/ });
    expect(una.textContent).not.toContain("$");
    expect(una.textContent).toMatch(/Hidden until per-user reporting/i);
  });
});

describe("TeamSpendPanel states (LD37; App Teams - AT6, AT7; Design System - LiteLLM Page, States)", () => {
  it.each([
    ["an unlinked team", false],
    ["a linked team", true],
  ] as const)(
    "%s with LiteLLM not configured: says so, with no figures and no error (LD37)",
    async (_n, connected) => {
      const { container } = (() => {
        stub(
          okData({
            configured: false,
            connected,
            spendSource: connected ? "litellm-team" : "member-sum",
            daily: [],
          }),
        );
        return renderPanel();
      })();

      expect(
        await screen.findByText(/LiteLLM not configured/i),
      ).toBeInTheDocument();
      expect(screen.queryByText(/LiteLLM unavailable/i)).toBeNull();
      expect(container.textContent).not.toContain("$");
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("a 503 shows 'LiteLLM unavailable' in the panel, not a crash (AT7)", async () => {
    stub(() => apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"));
    renderPanel();

    expect(await screen.findByText(/LiteLLM unavailable/i)).toBeInTheDocument();
  });

  it("a team above the member cap (422 TOO_MANY_MEMBERS) shows the route's message as an alert, not a crash (AT6)", async () => {
    stub(() =>
      apiError(422, "TOO_MANY_MEMBERS", "This team has more than 200 members"),
    );
    renderPanel(true);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This team has more than 200 members");
  });
});
