import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse, stubApi } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { NoAwsAccountTeams } from "./NoAwsAccountTeams";

// Source: Design System - "Source panels on Cost by team, Cost by user and
// Cost by service" (a created team appears in the Bedrock panel as a "No AWS
// account" row, never $0; the panel adds the `hasAwsAccount: false` teams of
// GET /api/access/org-units; GET /api/teams is unchanged) and M5-D3 (a second
// table captioned "Teams without an AWS account"; a tolerant read where only
// an explicit false counts, so M5 works before and after M2); Rule 20.3.
// Module under test: `components/teams/NoAwsAccountTeams.tsx`
//   <NoAwsAccountTeams department={departmentId | null} />  (client)
const DEPARTMENTS = [
  { id: "dept-eng", name: "Engineering" },
  { id: "dept-fin", name: "Finance" },
];

function unitsBody(teams: unknown[]) {
  return apiResponse({ data: { teams, departments: DEPARTMENTS } });
}

const CREATED = {
  id: "team-new",
  name: "Fresh Crew",
  departmentId: "dept-eng",
  hasAwsAccount: false,
};
const REGISTRY = {
  id: "team-pay",
  name: "Payments",
  departmentId: "dept-eng",
  hasAwsAccount: true,
};
const LEGACY = { id: "team-old", name: "Legacy", departmentId: "dept-fin" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NoAwsAccountTeams", () => {
  it("lists a created team with 'No AWS account' in its Bedrock cell, never $0", async () => {
    const stub = stubApi({
      orgUnits: () => unitsBody([CREATED, REGISTRY]),
    });
    renderWithProviders(<NoAwsAccountTeams department={null} />);
    const table = await screen.findByRole("table", {
      name: "Teams without an AWS account",
    });
    const row = within(table).getByRole("row", { name: /Fresh Crew/ });
    expect(row).toHaveTextContent("Engineering");
    expect(row).toHaveTextContent("No AWS account");
    expect(table).not.toHaveTextContent("$0");
    expect(within(table).queryByText("Payments")).toBeNull();
    expect(stub.orgUnitsRequests()).toHaveLength(1);
  });

  it("M5-D3: only an explicit hasAwsAccount false counts (absent = a registry team, before M2)", async () => {
    const stub = stubApi({ orgUnits: () => unitsBody([LEGACY, REGISTRY]) });
    const view = renderWithProviders(<NoAwsAccountTeams department={null} />);
    await waitFor(() => expect(stub.orgUnitsRequests()).toHaveLength(1));
    await waitFor(() => expect(view.container).toBeEmptyDOMElement());
    expect(screen.queryByText("Legacy")).toBeNull();
  });

  it("renders nothing when every team has an account", async () => {
    const stub = stubApi({ orgUnits: () => unitsBody([REGISTRY]) });
    const view = renderWithProviders(<NoAwsAccountTeams department={null} />);
    await waitFor(() => expect(stub.orgUnitsRequests()).toHaveLength(1));
    await waitFor(() => expect(view.container).toBeEmptyDOMElement());
  });

  it("follows the department filter of the page", async () => {
    stubApi({
      orgUnits: () =>
        unitsBody([
          CREATED,
          {
            ...CREATED,
            id: "team-fin",
            name: "Fin Crew",
            departmentId: "dept-fin",
          },
        ]),
    });
    renderWithProviders(<NoAwsAccountTeams department="dept-fin" />);
    const table = await screen.findByRole("table", {
      name: "Teams without an AWS account",
    });
    expect(within(table).getByText("Fin Crew")).toBeVisible();
    expect(within(table).queryByText("Fresh Crew")).toBeNull();
  });

  it("a failed read is a handled one-line state, not a crash", async () => {
    stubApi({ orgUnits: () => apiError(500) });
    renderWithProviders(<NoAwsAccountTeams department={null} />);
    expect(
      await screen.findByText(
        "Teams without an AWS account could not be loaded",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
