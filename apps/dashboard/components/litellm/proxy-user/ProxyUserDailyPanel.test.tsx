import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError } from "@/test/fakes/api-stubs";
import {
  PROXY_USER,
  PROXY_USER_CAPPED,
  PROXY_USER_ID,
  stubProxyUser,
} from "@/test/fixtures/proxy-user";
import { renderWithProviders } from "@/test/support/render-providers";

import { ProxyUserDailyPanel } from "./ProxyUserDailyPanel";

// The chart itself is covered by SpendTimelineChart.test.tsx; here it is a probe.
vi.mock("@/components/charts/LazyCharts", () => ({
  LazySpendTimelineChart: (props: { label: string }) => (
    <div role="img" aria-label={props.label} />
  ),
}));

// Sources: Design System - LiteLLM user page (unit LP2), T-LP8: "daily spend
// for the range"; LiteLLM spec - LD20 (UTC days), LD23 (the Organisation cap
// omits `daily`); Rule 40.3 (a chart loads through next/dynamic, never an
// eager recharts import); Rule 40.4.
// Unit LP3 (Design System - LiteLLM user page, name and spend over time,
// T-LP16): "Daily spend" becomes "Spend over time", the shared
// SpendTimelinePanel fed by the page's one read; the table that stood here is
// its Table view; absent under the cap, as before.
// Contract: ProxyUserDailyPanel({ litellmUserId }) in
// components/litellm/proxy-user/ProxyUserDailyPanel.tsx reads the same
// useProxyUser entry as the summary and renders a SpendTimelinePanel (region
// "Spend over time", its description naming UTC days) over `daily`.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = () =>
  renderWithProviders(<ProxyUserDailyPanel litellmUserId={PROXY_USER_ID} />, {
    searchParams: { dateFrom: "2026-11-01", dateTo: "2026-11-30" },
  });

describe("ProxyUserDailyPanel (T-LP8)", () => {
  it("T-LP16 / LD20: a region 'Spend over time' labelled in UTC days, with the Metric, Bucket size and View switches", async () => {
    stubProxyUser();
    render();
    const region = await screen.findByRole("region", {
      name: "Spend over time",
    });
    expect(
      within(region).getByRole("heading", { name: "Spend over time" }),
    ).toBeVisible();
    expect(region).toHaveTextContent(/UTC/);
    for (const name of ["Metric", "Bucket size", "View"]) {
      expect(within(region).getByRole("group", { name })).toBeVisible();
    }
    expect(
      within(region).queryByRole("group", { name: "Breakdown" }),
    ).toBeNull();
  });

  it("T-LP16: the Table view shows the user's daily rows from the page's one read", async () => {
    const calls = stubProxyUser({
      user: {
        ...PROXY_USER,
        daily: [{ date: "2026-11-14", spend: 4.5, requests: 3, tokens: 900 }],
      },
    });
    renderWithProviders(<ProxyUserDailyPanel litellmUserId={PROXY_USER_ID} />, {
      searchParams: {
        dateFrom: "2026-11-01",
        dateTo: "2026-11-30",
        view: "table",
      },
    });
    const region = await screen.findByRole("region", {
      name: "Spend over time",
    });
    const row = await within(region).findByRole("row", { name: /2026-11-14/ });
    expect(row).toHaveTextContent("$4.50");
    expect(
      calls.filter((c) => /^\/api\/litellm\/users\/[^/?]+(\?|$)/.test(c.path)),
    ).toHaveLength(1);
  });

  it("T-LP15 / T-LP16: no daily spend in the range says 'No daily spend reported.'", async () => {
    stubProxyUser({ user: { ...PROXY_USER, daily: [] } });
    render();
    const region = await screen.findByRole("region", {
      name: "Spend over time",
    });
    expect(
      await within(region).findByText("No daily spend reported."),
    ).toBeVisible();
  });

  it("T-LP16 / LD23: under the Organisation cap there is no Spend over time region", async () => {
    const calls = stubProxyUser({ user: PROXY_USER_CAPPED });
    render();
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Spend over time" }),
      ).toBeNull(),
    );
  });

  it("Rule 40.4: a failed read shows the panel's own error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubProxyUser({ user: () => apiError(500, "INTERNAL_ERROR", "boom") });
    render();
    expect(
      await screen.findByText(/Couldn't load spend over time\./i),
    ).toBeInTheDocument();
  });

  // Design System - LiteLLM user page, T-LP16 / Rule 40.4: while the read is
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
