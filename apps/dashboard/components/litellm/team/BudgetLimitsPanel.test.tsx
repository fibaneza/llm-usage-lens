import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { BudgetLimitsPanel } from "./BudgetLimitsPanel";

// Sources: review m4-r1 Q-W3 (coordinator decision, 2026-11-18): the Team
// page's OpenResetRequests renders whenever there are open requests, whatever
// the toggles say, because Deny must stay possible from the Team page; Approve
// stays disabled while the reset toggle (resetMemberSpend) is off, with a
// one-line reason. LiteLLM spec - MG-D12 ("a decision never depends on the
// bell"), MG-D11 (Approve runs resetMemberSpend). The route enforces the
// toggle again at the decision (BR4); this layer tests what the person sees.
const REQUEST = {
  id: "11111111-1111-4111-8111-111111111111",
  teamId: "t1",
  teamName: "Payments",
  requester: { oid: "oid-ada", displayName: "Ada", email: "ada@example.test" },
  reason: "need more budget",
  status: "open",
  createdAt: "2026-11-14T09:00:00.000Z",
  requestExpiresAt: "2026-11-21T09:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
};

const detail = (ops: string[]) => ({
  connected: true,
  spendSource: "litellm-team",
  team: {
    alias: "Payments",
    spend: 321.75,
    maxBudget: 500,
    softBudget: 400,
    budgetDuration: "30d",
    models: ["claude-sonnet"],
    rpmLimit: null,
    tpmLimit: null,
  },
  daily: [],
  enabledOperations: ops,
});

type Call = { method: string; path: string };

function stub(ops: string[]) {
  const calls: Call[] = [];
  const routes: Record<string, () => Response> = {
    "GET /api/litellm/teams/t1": () => apiResponse({ data: detail(ops) }),
    "GET /api/budget-resets": () => apiError(404, "NOT_FOUND", "none"),
    "GET /api/budget-reset-requests": () =>
      apiResponse({ data: { items: [REQUEST] } }),
    [`POST /api/budget-reset-requests/${REQUEST.id}/deny`]: () =>
      apiResponse({
        data: { request: { ...REQUEST, status: "denied" } },
      }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      const route = routes[`${method} ${path}`];
      if (!route) throw new Error(`unexpected ${method} ${path}`);
      return route();
    }),
  );
  return { calls, posts: () => calls.filter((c) => c.method === "POST") };
}

const renderPanel = () =>
  renderWithProviders(
    <BudgetLimitsPanel teamId="t1" capabilities={{ canRaiseLimits: false }} />,
  );
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("open budget reset requests on the Team page with the toggles off (review m4-r1 Q-W3; MG-D12)", () => {
  it("the request is listed even though resetMemberSpend and requestBudgetReset are off", async () => {
    stub(["setTeamBudget"]);
    renderPanel();
    expect(await screen.findByText("Ada")).toBeVisible();
    expect(screen.getByText("need more budget")).toBeVisible();
  });

  it("Approve is disabled with a one-line reason while resetMemberSpend is off", async () => {
    stub(["setTeamBudget"]);
    renderPanel();
    await screen.findByText("Ada");
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText(/switched off/i)).toBeVisible();
  });

  it("Deny still works: it opens its dialog and POSTs to /deny", async () => {
    const api = stub(["setTeamBudget"]);
    const u = user();
    renderPanel();
    await screen.findByText("Ada");
    await u.click(screen.getByRole("button", { name: "Deny" }));
    const dialog = await screen.findByRole("alertdialog");
    await u.click(within(dialog).getByRole("button", { name: "Deny request" }));
    await waitFor(() =>
      expect(api.posts().map((c) => c.path)).toEqual([
        `/api/budget-reset-requests/${REQUEST.id}/deny`,
      ]),
    );
  });

  it("with resetMemberSpend on, Approve is enabled and no switched-off reason shows (control case)", async () => {
    stub(["setTeamBudget", "resetMemberSpend"]);
    renderPanel();
    await screen.findByText("Ada");
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(screen.queryByText(/switched off/i)).toBeNull();
  });
});
