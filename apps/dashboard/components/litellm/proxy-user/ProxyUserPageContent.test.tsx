import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError } from "@/test/fakes/api-stubs";
import {
  PROXY_USER,
  PROXY_USER_ID,
  stubProxyUser,
} from "@/test/fixtures/proxy-user";
import { renderWithProviders } from "@/test/support/render-providers";

import { ProxyUserPageContent } from "./ProxyUserPageContent";

// Sources: Design System - LiteLLM user page (unit LP2, D-R3-8, D-R3-9),
// T-LP8: "identity, spend, budget, daily spend, teams, the linked person and
// their team, or 'Not linked to a dashboard user'"; "A breadcrumb leads back
// to the tab" (as the LiteLLM team page, T-LP4); Rule 40.4 / 40.9 / 60.12 (every
// section is a Panel with its own Suspense and ErrorBoundary); Rule 40.3
// (charts load lazily: no direct recharts import); Design System - LiteLLM
// client requests (T-FX2: the request carries the URL range).
//
// Contract (components/litellm/proxy-user/ProxyUserPageContent.tsx):
//   ProxyUserPageContent({ litellmUserId, canWrite, ownOid }: { litellmUserId:
//   string; canWrite: boolean; ownOid: string | null }) renders a PageHeader
//   whose breadcrumb has a link "LiteLLM users" to
//   /dashboard/manage/litellm/users, then Panels "Summary"
//   (ProxyUserSummaryPanel), "Daily spend" (ProxyUserDailyPanel), "LiteLLM
//   teams" (ProxyUserTeamsPanel) and "Linked dashboard user"
//   (ProxyUserLinkPanel, canWrite and ownOid passed through). The page makes one
//   GET to /api/litellm/users/[id] for all four.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = (canWrite = true) =>
  renderWithProviders(
    <ProxyUserPageContent
      litellmUserId={PROXY_USER_ID}
      canWrite={canWrite}
      ownOid="oid-admin"
    />,
    { searchParams: { dateFrom: "2026-11-01", dateTo: "2026-11-30" } },
  );

describe("ProxyUserPageContent (T-LP8)", () => {
  it("T-LP8: breadcrumb link back to the LiteLLM users tab", async () => {
    stubProxyUser();
    render();
    expect(
      await screen.findByRole("link", { name: "LiteLLM users" }),
    ).toHaveAttribute("href", "/dashboard/manage/litellm/users");
  });

  it("T-LP8 / Rule 40.9: Summary, Daily spend, LiteLLM teams and Linked dashboard user are four regions, each with a heading", async () => {
    stubProxyUser();
    render();
    for (const name of [
      "Summary",
      "Daily spend",
      "LiteLLM teams",
      "Linked dashboard user",
    ]) {
      const region = await screen.findByRole("region", { name });
      expect(within(region).getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("T-LP8: shows identity, spend, budget, the teams and the linked person from the one read", async () => {
    const calls = stubProxyUser();
    render(false);
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(await within(summary).findByText("$77.10")).toBeVisible();
    expect(within(summary).getByText("ada@example.test")).toBeVisible();
    expect(within(summary).getByText("$150.00")).toBeVisible();
    expect(
      await screen.findByRole("link", { name: "Payments LLM" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("link", { name: "Ada Lovelace" }),
    ).toHaveAttribute("href", "/dashboard/manage/users/oid-ada");
    const reads = calls.filter((c) =>
      /^\/api\/litellm\/users\/[^/?]+(\?|$)/.test(c.path),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.path).toContain("dateFrom=2026-11-01");
    expect(reads[0]?.path).toContain("dateTo=2026-11-30");
  });

  it("T-LP8: an unlinked user shows 'Not linked to a dashboard user' on the page", async () => {
    stubProxyUser({ user: { ...PROXY_USER, appUser: null, teams: [] } });
    render(false);
    expect(
      await screen.findByText("Not linked to a dashboard user"),
    ).toBeVisible();
  });

  it("T-LP9: canWrite passes through: Reset spend shows with it and is absent without", async () => {
    stubProxyUser();
    const first = render(true);
    expect(
      await screen.findByRole("button", {
        name: "Reset spend for Ada Lovelace",
      }),
    ).toBeVisible();
    first.unmount();
    stubProxyUser();
    render(false);
    await screen.findByRole("link", { name: "Ada Lovelace" });
    expect(screen.queryByRole("button", { name: /reset spend/i })).toBeNull();
  });

  it("Rule 40.4: a failed read leaves each panel with its own error and the breadcrumb stays", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubProxyUser({ user: () => apiError(500, "INTERNAL_ERROR", "boom") });
    render();
    expect(
      await screen.findByText("Couldn't load Summary."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LiteLLM users" })).toBeVisible();
  });

  // Rule 40.3: the chart is lazy (components/charts/LazyCharts.tsx); a direct
  // recharts import in this folder would put it in the page's first load.
  it("Rule 40.3: no file in components/litellm/proxy-user imports recharts directly", () => {
    const here = resolve(import.meta.dirname);
    const offenders = readdirSync(here)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) =>
        /from\s+["']recharts["']/.test(readFileSync(resolve(here, f), "utf8")),
      );
    expect(offenders).toEqual([]);
  });
});
