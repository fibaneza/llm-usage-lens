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
//   (ProxyUserSummaryPanel), "Spend over time" (ProxyUserDailyPanel, LP3), "LiteLLM
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

const render = (canWrite = true, name: string | null = null) =>
  renderWithProviders(
    <ProxyUserPageContent
      litellmUserId={PROXY_USER_ID}
      name={name}
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

  it("T-LP8 / T-LP16 / Rule 40.9: Summary, Spend over time, LiteLLM teams and Linked dashboard user are four regions, each with a heading", async () => {
    stubProxyUser();
    render();
    for (const name of [
      "Summary",
      "Spend over time",
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

  // T-LP13 (Design System - LiteLLM user page, name and spend over time): the
  // breadcrumb's last item is the name the page resolved on the server (alias,
  // else email), else the id; one line, truncated, the full value in `title`;
  // never rendered as HTML.
  const crumb = (text: string) => {
    const nav = screen.getByRole("navigation", { name: /breadcrumb/i });
    return within(nav).getByText(text);
  };

  it("T-LP13: with a name the breadcrumb's last item is the name, not the id", async () => {
    stubProxyUser();
    render(true, "ada-alias");
    const last = crumb("ada-alias");
    expect(last).toHaveAttribute("aria-current", "page");
    expect(
      within(
        screen.getByRole("navigation", { name: /breadcrumb/i }),
      ).queryByText(PROXY_USER_ID),
    ).toBeNull();
    await screen.findByRole("region", { name: "Summary" });
  });

  it("T-LP13: without a name (no call, or the call failed) the last item is the id", async () => {
    stubProxyUser();
    render(true, null);
    expect(crumb(PROXY_USER_ID)).toHaveAttribute("aria-current", "page");
    await screen.findByRole("region", { name: "Summary" });
  });

  it("T-LP13: a long name keeps its full value in `title` (the breadcrumb truncates it), and a name is text, never HTML", async () => {
    stubProxyUser();
    const long = `${"very-long-alias-".repeat(10)}<b>x</b>`;
    const { container } = render(true, long);
    const last = crumb(long);
    expect(last).toHaveAttribute("title", long);
    expect(last).toHaveClass("truncate");
    expect(
      container.querySelectorAll(`[title="${CSS.escape(long)}"]`),
    ).toHaveLength(1);
    expect(container.querySelector("nav b")).toBeNull();
    await screen.findByRole("region", { name: "Summary" });
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
