import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse, stubApi } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { UsersLiteLLMPanel } from "./UsersLiteLLMPanel";

// Source: Design System - "Source panels on Cost by team, Cost by user and
// Cost by service" (Cost by user: the LiteLLM users list, GET
// /api/litellm/users with no search text, 25 a page, server-side paging
// (D16a); `spend` labelled "LiteLLM-reported, total to date"; the range
// figure for one person is under Management -> LiteLLM -> LiteLLM users; under
// the Organisation cap per-user spend is hidden and the panel says so);
// M5-D4, M5-D6; LiteLLM spec LD23, LD34 (one /user/list page per request);
// "not in LiteLLM", never $0.
// Module under test: `components/users/UsersLiteLLMPanel.tsx` (client)
const PAGE_SIZE = 25;

function user(i: number, overrides: Record<string, unknown> = {}) {
  return {
    userId: `u-${i}`,
    email: `person${String(i).padStart(2, "0")}@example.test`,
    spend: i + 0.5,
    maxBudget: null,
    teams: i % 2 ? [{ teamId: "t-1", teamName: "Platform" }] : [],
    ...overrides,
  };
}

function usersBody(users: unknown[], page = 1) {
  return apiResponse({
    data: { users, page, pageSize: PAGE_SIZE, enabledOperations: [] },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel() {
  return renderWithProviders(
    <Suspense fallback={<p>loading</p>}>
      <UsersLiteLLMPanel />
    </Suspense>,
  );
}

describe("UsersLiteLLMPanel", () => {
  it("lists users with email, teams and spend under the 'LiteLLM-reported, total to date' header", async () => {
    stubApi({ litellmUsers: () => usersBody([user(1), user(2)]) });
    renderPanel();
    const table = await screen.findByRole("table", { name: "LiteLLM users" });
    expect(
      within(table).getByRole("columnheader", {
        name: /LiteLLM-reported, total to date/,
      }),
    ).toBeVisible();
    const first = within(table).getByRole("row", { name: /person01/ });
    expect(first).toHaveTextContent("Platform");
    expect(first).toHaveTextContent("$1.50");
  });

  it("requests page 1 with no search text (D16a)", async () => {
    const stub = stubApi({ litellmUsers: () => usersBody([user(1)]) });
    renderPanel();
    await screen.findByRole("table");
    const req = stub.litellmUsersRequests()[0] as URL;
    expect(req.searchParams.get("page")).toBe("1");
    expect(req.searchParams.has("q")).toBe(false);
  });

  it("pages on the server: Next asks page 2, Previous returns; Next is off on a short page", async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_u, i) => user(i));
    const stub = stubApi({
      litellmUsers: (url) =>
        url.searchParams.get("page") === "2"
          ? usersBody([user(40)], 2)
          : usersBody(full),
    });
    renderPanel();
    await screen.findByRole("table");
    const next = screen.getByRole("button", { name: "Next" });
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await userEvent.setup().click(next);
    expect(await screen.findByText("person40@example.test")).toBeVisible();
    expect(
      stub.litellmUsersRequests().map((u) => u.searchParams.get("page")),
    ).toContain("2");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });

  it("LD23 cap: a user without spend reads 'Hidden', never $0, and the panel says per-user spend is hidden", async () => {
    stubApi({
      litellmUsers: () =>
        usersBody([
          user(1, { spend: undefined }),
          user(2, { spend: undefined }),
        ]),
    });
    renderPanel();
    const table = await screen.findByRole("table");
    expect(
      screen.getByText("Per-user spend is hidden by the Organisation cap."),
    ).toBeVisible();
    const row = within(table).getByRole("row", { name: /person01/ });
    expect(row).toHaveTextContent("Hidden");
    expect(table).not.toHaveTextContent("$0");
  });

  it("M5-D4: points to Management -> LiteLLM -> LiteLLM users for the range figure of one person", async () => {
    stubApi({ litellmUsers: () => usersBody([user(1)]) });
    renderPanel();
    await screen.findByRole("table");
    expect(
      screen.getByRole("link", {
        name: "Management → LiteLLM → LiteLLM users",
      }),
    ).toHaveAttribute("href", "/dashboard/manage/litellm/users");
  });

  it("M5-D6 empty: 'No LiteLLM users' and no table", async () => {
    stubApi({}); // default users body is an empty page
    renderPanel();
    expect(await screen.findByText("No LiteLLM users")).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("a 503 LITELLM_UNAVAILABLE is the handled unavailable state", async () => {
    stubApi({
      litellmUsers: () => apiError(503, "LITELLM_UNAVAILABLE", "down"),
    });
    renderPanel();
    expect(await screen.findByText(/unavailable/i)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
  });
});
