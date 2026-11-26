import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError } from "@/test/fakes/api-stubs";
import {
  PROXY_TEAM_DAILY_CAPPED,
  PROXY_TEAM_ID,
  stubProxyTeam,
} from "@/test/fixtures/proxy-team";
import { renderWithProviders } from "@/test/support/render-providers";

import { ProxyTeamDailyPanel } from "./ProxyTeamDailyPanel";

// Sources: Design System - LiteLLM team page, name and spend over time (unit
// LP3, T-LP16): "A Spend over time panel stands between Summary and Members:
// the shared SpendTimelinePanel, fed by GET /api/litellm/proxy-teams/
// [litellmTeamId]/daily for the URL range. It has its own Suspense and
// ErrorBoundary ... It is absent while the cap hides cost"; LiteLLM spec - API
// routes (the daily route: `daily` omitted under the cap, LD23); LD20 (UTC
// days); Rule 40.3, 40.4.
// Contract: ProxyTeamDailyPanel({ litellmTeamId }) in
// components/litellm/proxy-team/ProxyTeamDailyPanel.tsx reads through
// use-proxy-team-daily.ts and renders a SpendTimelinePanel (region "Spend over
// time"); it renders nothing when the answer has no `daily`.
vi.mock("@/components/charts/LazyCharts", () => ({
  LazySpendTimelineChart: (props: { label: string }) => (
    <div role="img" aria-label={props.label} />
  ),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = (searchParams: Record<string, string> = {}) =>
  renderWithProviders(<ProxyTeamDailyPanel litellmTeamId={PROXY_TEAM_ID} />, {
    searchParams: {
      dateFrom: "2026-11-01",
      dateTo: "2026-11-30",
      ...searchParams,
    },
  });

describe("ProxyTeamDailyPanel (T-LP16)", () => {
  it("T-LP16 / LD20: a region 'Spend over time' with the three switches, from one daily read that carries the URL range", async () => {
    const calls = stubProxyTeam();
    render();
    const region = await screen.findByRole("region", {
      name: "Spend over time",
    });
    for (const name of ["Metric", "Bucket size", "View"]) {
      expect(within(region).getByRole("group", { name })).toBeVisible();
    }
    expect(region).toHaveTextContent(/UTC/);
    const reads = calls.filter((c) => c.path.endsWith("/daily"));
    expect(reads).toHaveLength(1);
    expect(reads[0]?.path).toBe("/api/litellm/proxy-teams/ll-team-1/daily");
    expect(reads[0]?.search).toContain("dateFrom=2026-11-01");
    expect(reads[0]?.search).toContain("dateTo=2026-11-30");
  });

  it("T-LP16: the Table view shows the team's daily rows", async () => {
    stubProxyTeam();
    render({ view: "table" });
    const region = await screen.findByRole("region", {
      name: "Spend over time",
    });
    expect(
      await within(region).findByRole("row", { name: /2026-11-14/ }),
    ).toHaveTextContent("$4.50");
  });

  it("T-LP16 / LD23: an answer without `daily` (the cap) renders no region", async () => {
    const calls = stubProxyTeam({ daily: PROXY_TEAM_DAILY_CAPPED });
    render();
    await vi.waitFor(() =>
      expect(calls.some((c) => c.path.endsWith("/daily"))).toBe(true),
    );
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Spend over time" }),
      ).toBeNull(),
    );
  });

  it("Rule 40.4 / T-LP16: a failed read shows the panel's own error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubProxyTeam({ daily: () => apiError(500, "INTERNAL_ERROR", "boom") });
    render();
    expect(
      await screen.findByText(/Couldn't load spend over time\./i),
    ).toBeInTheDocument();
  });

  // Design System - LiteLLM team page, T-LP16 / Rule 40.4: while the read is
  // pending the fallback reserves the panel's height (h-96, about the
  // chart panel), so the page does not jump when the chart arrives.
  it("T-LP16 / Rule 40.4: while the read is pending the skeleton reserves the panel height (h-96)", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const { container } = render();
    await vi.waitFor(() =>
      expect(container.querySelector('[data-slot="skeleton"]')).toHaveClass(
        "h-96",
      ),
    );
  });
});
