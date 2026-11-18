import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse, stubApi } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamsLiteLLMPanel } from "./TeamsLiteLLMPanel";

// Source: Design System - "Source panels on Cost by team, Cost by user and
// Cost by service" (What each LiteLLM panel shows - Cost by team: the app
// teams of GET /api/litellm/org with source badge and coverage, the LiteLLM
// teams total as the panel total (LD33), "Sum of members" on request for a
// linked row and an open-team row through GET /api/litellm/teams/[teamId]
// ?include=memberSum; "Not in LiteLLM", never $0; M5-D5, M5-D6); App Teams
// spec - Member sum and AT6 (no member read until asked); LiteLLM spec -
// MI-D7, LD34; implementation-phases M5 Verify.
// Module under test: `components/teams/TeamsLiteLLMPanel.tsx`
//   <TeamsLiteLLMPanel range={{ dateFrom, dateTo }} />  (client)
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };

const FULL = { members: 2, matched: 2, unmatched: 0, pending: 0 };

function org(appTeams: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    totals: { spend: 42.5 },
    daily: [],
    litellmTeams: [],
    appTeams,
    enabledOperations: [],
    ...overrides,
  };
}

const LINKED = {
  teamId: "team-pay",
  teamName: "Payments",
  spendSource: "litellm-team",
  spend: 12.5,
};
const UNLINKED_SUM = {
  teamId: "team-ledger",
  teamName: "Ledger",
  spendSource: "member-sum",
  spend: 3,
  coverage: FULL,
};
const NO_MATCH = {
  teamId: "team-none",
  teamName: "Strangers",
  spendSource: "member-sum",
  spend: 0,
  coverage: { members: 3, matched: 0, unmatched: 3, pending: 0 },
};
const OPEN_TEAM = {
  teamId: "team-open",
  teamName: "Open Crew",
  spendSource: "member-sum",
  spend: null,
  reason: "open-team",
};

function memberSumBody(
  overrides: { connected?: boolean; total?: number; members?: unknown[] } = {},
) {
  const members = overrides.members ?? [
    { oid: "oid-a", name: "Ada", matched: true, spend: 4 },
    { oid: "oid-b", name: "Bob", matched: false },
  ];
  const memberSum = {
    total: overrides.total ?? 4,
    daily: [],
    coverage: { members: 2, matched: 1, unmatched: 1, pending: 0 },
    members,
  };
  return overrides.connected === false
    ? { connected: false, spendSource: "member-sum", daily: [], memberSum }
    : {
        connected: true,
        spendSource: "litellm-team",
        team: {
          alias: null,
          spend: 12.5,
          maxBudget: null,
          softBudget: null,
          budgetDuration: null,
          models: [],
          rpmLimit: null,
          tpmLimit: null,
        },
        daily: [],
        enabledOperations: [],
        memberSum,
      };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel() {
  return renderWithProviders(
    <Suspense fallback={<p>loading</p>}>
      <TeamsLiteLLMPanel range={RANGE} />
    </Suspense>,
  );
}

describe("TeamsLiteLLMPanel -- rows", () => {
  it("requests /api/litellm/org for the range and shows the LiteLLM teams total (LD33) with the overlap line", async () => {
    const stub = stubApi({
      litellmOrg: () => apiResponse({ data: org([LINKED]) }),
    });
    renderPanel();
    expect(await screen.findByText("$42.50")).toBeInTheDocument();
    expect(screen.getByText(/Rows overlap and do not add up/)).toBeVisible();
    const req = stub.litellmOrgRequests()[0] as URL;
    expect(req.searchParams.get("dateFrom")).toBe(RANGE.dateFrom);
    expect(req.searchParams.get("dateTo")).toBe(RANGE.dateTo);
  });

  it("one row per app team with its source badge, spend and coverage", async () => {
    stubApi({
      litellmOrg: () => apiResponse({ data: org([LINKED, UNLINKED_SUM]) }),
    });
    renderPanel();
    const table = await screen.findByRole("table", {
      name: "App teams (LiteLLM)",
    });
    const payments = within(table).getByRole("row", { name: /Payments/ });
    expect(payments).toHaveTextContent("LiteLLM team");
    expect(payments).toHaveTextContent("$12.50");
    const ledger = within(table).getByRole("row", { name: /Ledger/ });
    expect(ledger).toHaveTextContent("Sum of members");
    expect(ledger).toHaveTextContent("$3.00");
    expect(ledger).toHaveTextContent("2 members: 2 matched");
  });

  it("a member-sum row where no member matched reads 'not in LiteLLM', never $0 (App Teams - Member sum)", async () => {
    stubApi({
      litellmOrg: () => apiResponse({ data: org([NO_MATCH]) }),
    });
    renderPanel();
    const row = await screen.findByRole("row", { name: /Strangers/ });
    expect(row).toHaveTextContent("not in LiteLLM");
    expect(row).not.toHaveTextContent("$0");
  });

  it("an open-team row without a figure is never $0 (spend null)", async () => {
    stubApi({ litellmOrg: () => apiResponse({ data: org([OPEN_TEAM]) }) });
    renderPanel();
    const row = await screen.findByRole("row", { name: /Open Crew/ });
    expect(row).not.toHaveTextContent("$0");
  });

  it("M5-D6 not configured: says so and draws no table", async () => {
    stubApi({}); // default org body is the not-configured one
    renderPanel();
    expect(await screen.findByText("LiteLLM not configured")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("M5-D6 configured with no app teams: a one-line text and no table", async () => {
    stubApi({ litellmOrg: () => apiResponse({ data: org([]) }) });
    renderPanel();
    expect(await screen.findByText("No app teams")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("a 503 LITELLM_UNAVAILABLE is the handled unavailable state", async () => {
    stubApi({
      litellmOrg: () => apiError(503, "LITELLM_UNAVAILABLE", "down"),
    });
    renderPanel();
    expect(await screen.findByText(/unavailable/i)).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("TeamsLiteLLMPanel -- Sum of members on request (MI-D7, AT6)", () => {
  it("makes no /api/litellm/teams request on first load", async () => {
    const stub = stubApi({
      litellmOrg: () =>
        apiResponse({ data: org([LINKED, UNLINKED_SUM, OPEN_TEAM]) }),
    });
    renderPanel();
    await screen.findByRole("table");
    expect(stub.litellmTeamRequests()).toHaveLength(0);
  });

  it("offers the button on a linked row and an open-team row, not on an unlinked row whose spend is already summed", async () => {
    stubApi({
      litellmOrg: () =>
        apiResponse({ data: org([LINKED, UNLINKED_SUM, OPEN_TEAM]) }),
    });
    renderPanel();
    await screen.findByRole("table");
    expect(
      screen.getByRole("button", { name: "Sum of members for Payments" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Sum of members for Open Crew" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Sum of members for Ledger" }),
    ).toBeNull();
  });

  it("a press on a linked row requests the team once with include=memberSum and shows the figure with Why the figures differ", async () => {
    const stub = stubApi({
      litellmOrg: () => apiResponse({ data: org([LINKED]) }),
      litellmTeam: () => apiResponse({ data: memberSumBody({ total: 4 }) }),
    });
    renderPanel();
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "Sum of members for Payments",
      }),
    );
    expect(
      await screen.findByText(/Sum of members for Payments:/),
    ).toBeVisible();
    const row = screen.getByRole("row", { name: /Payments/ });
    expect(row).toHaveTextContent("$4.00");
    expect(
      screen.getByText(/everything each app member spent through the gateway/),
    ).toBeVisible();

    const requests = stub.litellmTeamRequests();
    expect(requests).toHaveLength(1);
    const req = requests[0] as URL;
    expect(req.pathname).toBe("/api/litellm/teams/team-pay");
    expect(req.searchParams.get("include")).toBe("memberSum");
    expect(req.searchParams.get("dateFrom")).toBe(RANGE.dateFrom);
    expect(req.searchParams.get("dateTo")).toBe(RANGE.dateTo);
  });

  it("a press on an open-team row shows its member sum (no figure of the other source)", async () => {
    const stub = stubApi({
      litellmOrg: () => apiResponse({ data: org([OPEN_TEAM]) }),
      litellmTeam: () =>
        apiResponse({ data: memberSumBody({ connected: false, total: 7 }) }),
    });
    renderPanel();
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "Sum of members for Open Crew",
      }),
    );
    const row = await screen.findByRole("row", { name: /Open Crew/ });
    await waitFor(() => expect(row).toHaveTextContent("$7.00"));
    expect(stub.litellmTeamRequests()).toHaveLength(1);
    expect(
      screen.queryByText(
        /everything each app member spent through the gateway/,
      ),
    ).toBeNull();
  });

  it("an unmatched member reads 'not in LiteLLM', never $0 (App Teams - Member sum)", async () => {
    stubApi({
      litellmOrg: () => apiResponse({ data: org([LINKED]) }),
      litellmTeam: () => apiResponse({ data: memberSumBody() }),
    });
    renderPanel();
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "Sum of members for Payments",
      }),
    );
    await screen.findByText(/Sum of members for Payments:/);
    const bob = screen.getByRole("row", { name: /Bob/ });
    expect(bob).toHaveTextContent("not in LiteLLM");
    expect(bob).not.toHaveTextContent("$0");
  });

  it.each([
    [422, "TOO_MANY_MEMBERS", "Too many members to sum (over 200)"],
    [403, "OPERATION_DISABLED", "Switched off"],
    [503, "LITELLM_UNAVAILABLE", "LiteLLM unavailable"],
    [404, "NOT_FOUND", "Team not found"],
  ])(
    "M5-D5 row state for %s %s: %j, and the rest of the panel stays",
    async (status, code, text) => {
      stubApi({
        litellmOrg: () => apiResponse({ data: org([LINKED, UNLINKED_SUM]) }),
        litellmTeam: () => apiError(status, code, "x"),
      });
      renderPanel();
      await userEvent.setup().click(
        await screen.findByRole("button", {
          name: "Sum of members for Payments",
        }),
      );
      expect(await screen.findByText(text)).toBeVisible();
      expect(
        screen.getByRole("table", { name: "App teams (LiteLLM)" }),
      ).toBeVisible();
    },
  );
});
