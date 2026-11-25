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

// Sources: Design System - LiteLLM user page (unit LP2), T-LP8: "daily spend
// for the range"; LiteLLM spec - LD20 (UTC days), LD23 (the Organisation cap
// omits `daily`); Rule 40.3 (a chart loads through next/dynamic, never an
// eager recharts import); Rule 40.4.
// Contract: ProxyUserDailyPanel({ litellmUserId }) in
// components/litellm/proxy-user/ProxyUserDailyPanel.tsx reads the same
// useProxyUser entry as the summary and renders a Panel region "Daily spend".
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = () =>
  renderWithProviders(<ProxyUserDailyPanel litellmUserId={PROXY_USER_ID} />, {
    searchParams: { dateFrom: "2026-11-01", dateTo: "2026-11-30" },
  });

describe("ProxyUserDailyPanel (T-LP8)", () => {
  it("T-LP8 / LD20: a region 'Daily spend' labelled in UTC days", async () => {
    stubProxyUser();
    render();
    const region = await screen.findByRole("region", { name: "Daily spend" });
    expect(
      within(region).getByRole("heading", { name: "Daily spend" }),
    ).toBeVisible();
    expect(region).toHaveTextContent(/UTC/);
  });

  it("T-LP8: no daily spend in the range says 'No daily spend reported.'", async () => {
    stubProxyUser({ user: { ...PROXY_USER, daily: [] } });
    render();
    const region = await screen.findByRole("region", { name: "Daily spend" });
    expect(
      await within(region).findByText("No daily spend reported."),
    ).toBeVisible();
  });

  it("T-LP8 / LD23: under the Organisation cap there is no Daily spend region", async () => {
    const calls = stubProxyUser({ user: PROXY_USER_CAPPED });
    render();
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await vi.waitFor(() =>
      expect(screen.queryByRole("region", { name: "Daily spend" })).toBeNull(),
    );
  });

  it("Rule 40.4: a failed read shows the panel's own error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubProxyUser({ user: () => apiError(500, "INTERNAL_ERROR", "boom") });
    render();
    expect(
      await screen.findByText("Couldn't load Daily spend."),
    ).toBeInTheDocument();
  });
});
