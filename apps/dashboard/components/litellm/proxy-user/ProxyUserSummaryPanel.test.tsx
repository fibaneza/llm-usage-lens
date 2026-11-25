import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError } from "@/test/fakes/api-stubs";
import { personShow } from "@/test/fakes/combined-stubs";
import {
  PROXY_USER,
  PROXY_USER_CAPPED,
  PROXY_USER_ID,
  stubProxyUser,
} from "@/test/fixtures/proxy-user";
import { renderWithProviders } from "@/test/support/render-providers";

import { ProxyUserSummaryPanel } from "./ProxyUserSummaryPanel";

// Sources: Design System - LiteLLM user page (unit LP2, user, 2026-11-25;
// D-R3-8, D-R3-9), T-LP8: "user id and email; spend and budget; daily spend
// for the range; the combined figure (L6)"; LiteLLM spec - API routes, GET
// /api/litellm/users/[litellmUserId] (requires dateFrom and dateTo), LD20
// (UTC days), LD23 (the Organisation cap omits spend and budget), LT8
// (LiteLLM-reported), L6 (combined, hidden body), LT21 (a 404 is the same for
// missing and out of scope); Design System - LiteLLM client requests (T-FX2:
// the request carries the URL range); Rule 40.4 / 60.12 (own error state);
// Rule 60.24a.
//
// Contract (new modules in components/litellm/proxy-user/):
//   use-proxy-user.ts exports useProxyUser(litellmUserId) (suspending,
//   Suspense-based like useProxyTeam) and useProxyUserState(litellmUserId)
//   (non-suspending), both reading GET /api/litellm/users/<encoded id>?
//   dateFrom=..&dateTo=.. (the URL range, useUrlRange) and parsing with
//   LiteLLMUserDetailResponseSchema; one cache entry, so a page makes one
//   request.
//   ProxyUserSummaryPanel({ litellmUserId }): a Panel region "Summary" with the
//   user id (monospace), the email, "Spend", "Budget" and the LiteLLM-reported
//   badge, plus a "Combined usage" region (CombinedPersonCard) when the answer
//   has `combined` and it is not hidden.
//   The daily spend for the range is its own Panel "Daily spend", rendered by
//   ProxyUserDailyPanel({ litellmUserId }) in ProxyUserDailyPanel.tsx (tested
//   here with the summary because they share the read): a region "Daily spend"
//   with the UTC-day figures, or "No daily spend reported." when `daily` is [];
//   absent under the cap (no `daily` in the answer).
const RANGE = { dateFrom: "2026-11-01", dateTo: "2026-11-30" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = (id = PROXY_USER_ID) =>
  renderWithProviders(<ProxyUserSummaryPanel litellmUserId={id} />, {
    searchParams: RANGE,
  });
const summary = () => screen.findByRole("region", { name: "Summary" });

describe("ProxyUserSummaryPanel (T-LP8)", () => {
  it("T-LP8: shows the user id and the email", async () => {
    stubProxyUser();
    render();
    const region = await summary();
    expect(await within(region).findByText("ada@example.test")).toBeVisible();
    expect(within(region).getByText("ll-ada")).toBeVisible();
  });

  it("T-LP8 / LT8: shows spend and budget in USD with the LiteLLM-reported label", async () => {
    stubProxyUser();
    render();
    const region = await summary();
    expect(await within(region).findByText("$77.10")).toBeVisible();
    expect(within(region).getByText("$150.00")).toBeVisible();
    expect(
      within(region).getAllByText("LiteLLM-reported").length,
    ).toBeGreaterThan(0);
  });

  it("T-LP8 / D-LF1: no budget reads 'No limit'", async () => {
    stubProxyUser({ user: { ...PROXY_USER, maxBudget: null } });
    render();
    const region = await summary();
    expect(await within(region).findByText(/no limit/i)).toBeVisible();
  });

  // Design System - LiteLLM users tab, D-LF1 and T-LF1: LiteLLM reports no
  // usage for the user: a dash, no error, never $0.
  it("T-LP8 / D-LF1: a user with no reported usage shows an em dash for spend, no alert and no $0", async () => {
    stubProxyUser({
      user: { ...PROXY_USER, spend: null, maxBudget: null, daily: [] },
    });
    render();
    const region = await summary();
    expect(await within(region).findByText("—")).toBeVisible();
    expect(within(region).queryByRole("alert")).toBeNull();
    expect(region).not.toHaveTextContent("$0");
    expect(region).not.toHaveTextContent(/hidden until/i);
  });

  it("T-LP8 / LD23: under the Organisation cap spend and budget are omitted: no figure, no $0, no 'No limit'", async () => {
    stubProxyUser({ user: PROXY_USER_CAPPED });
    render();
    const region = await summary();
    expect(await within(region).findByText("ada@example.test")).toBeVisible();
    expect(region.textContent).not.toMatch(/\$\d/);
    expect(within(region).queryByText(/no limit/i)).toBeNull();
    expect(region).toHaveTextContent(/hidden until per-user reporting/i);
  });

  it("T-LP8 / L6: the combined figure comes from the answer's `combined`, with no second request", async () => {
    const calls = stubProxyUser({
      user: { ...PROXY_USER, combined: personShow() },
    });
    render();
    const card = await screen.findByRole("region", { name: "Combined usage" });
    expect(within(card).getByTestId("combined-total")).toHaveTextContent(
      "$15.00",
    );
    expect(calls.some((c) => c.path.includes("/combined/"))).toBe(false);
  });

  it("T-LP8 / L6: no combined region when the answer omits it (cap)", async () => {
    stubProxyUser();
    render();
    await summary();
    await screen.findByText("$77.10");
    expect(screen.queryByRole("region", { name: "Combined usage" })).toBeNull();
  });

  it("T-LP8 / L6: a hidden combined body shows no combined region and no total", async () => {
    stubProxyUser({
      user: {
        ...PROXY_USER,
        combined: {
          visibility: "hidden",
          configured: true,
          gatewayConfigured: false,
        },
      },
    });
    render();
    await screen.findByText("$77.10");
    expect(screen.queryByRole("region", { name: "Combined usage" })).toBeNull();
    expect(screen.queryByTestId("combined-total")).toBeNull();
  });

  // T-FX2 / LT3: the route requires the range; the id is one path segment.
  it("T-FX2 / LT3: one GET to the user route with dateFrom and dateTo from the URL and the id percent-encoded", async () => {
    const calls = stubProxyUser();
    render("ll/odd id");
    await summary();
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    const url = new URL(calls[0]?.path ?? "", "http://localhost");
    expect(url.pathname).toBe("/api/litellm/users/ll%2Fodd%20id");
    expect(url.searchParams.get("dateFrom")).toBe(RANGE.dateFrom);
    expect(url.searchParams.get("dateTo")).toBe(RANGE.dateTo);
  });

  it("LD19 / Rule 40.4: a LiteLLM outage (503) shows the unavailable state, not a crash", async () => {
    stubProxyUser({
      user: () =>
        apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"),
    });
    render();
    expect(await screen.findByText(/litellm.*unavailable/i)).toBeVisible();
  });

  it("Rule 40.4: any other failed read shows the panel's own error and does not throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubProxyUser({ user: () => apiError(500, "INTERNAL_ERROR", "boom") });
    render();
    expect(
      await screen.findByText("Couldn't load Summary."),
    ).toBeInTheDocument();
  });
});
