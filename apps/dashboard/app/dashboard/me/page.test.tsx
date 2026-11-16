import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse, NEVER } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import MePage from "./page";

// Source: implementation-phases Phase 4R.5 (My usage page /dashboard/me; "no
// team" and "not visible" states); Design System - "Access states and scoped
// labels" (No team: My usage plus "Ask your team lead for access"; Not
// visible: a neutral inline notice, never a zero); Access Control spec -
// Roles (My usage: any signed-in role) and "Canonical usage identity";
// Rule 40.4 / 60.12 (own skeleton and error state); Rule 60.7 (Server
// Component shell). Data: GET /api/me and GET /api/me/usage (existing 4R.3
// routes). Rule 60.24: fetch is stubbed.
afterEach(() => {
  vi.unstubAllGlobals();
});

const ME = {
  oid: "oid-1",
  email: "a1@company.com",
  roles: ["internal-viewer"],
  usageIdentities: ["a1@company.com"],
  global: false,
  memberTeamId: "team-a",
  memberTeamVisible: true,
  teamScopes: [] as string[],
  departmentScopes: [] as string[],
};
const USAGE = {
  totals: { cost: 12.5, inputTokens: 1200, outputTokens: 300, invocations: 42 },
  daily: [
    {
      date: "2026-01-11",
      cost: 12.5,
      inputTokens: 1200,
      outputTokens: 300,
      invocations: 42,
    },
  ],
};
const EMPTY_USAGE = {
  totals: { cost: 0, inputTokens: 0, outputTokens: 0, invocations: 0 },
  daily: [],
};

function stub(me: () => Promise<Response>, usage: () => Promise<Response>) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      urls.push(url.pathname + url.search);
      if (url.pathname === "/api/me/usage") return usage();
      if (url.pathname === "/api/me") return me();
      return Promise.resolve(apiError(404, "NOT_FOUND", "unexpected"));
    }),
  );
  return urls;
}
const ok = (data: unknown) => () => Promise.resolve(apiResponse({ data }));
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };

describe("MePage (/dashboard/me)", () => {
  it("stays a Server Component shell (Rule 60.7)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  it("shows the caller's own Bedrock totals for the URL date range", async () => {
    const urls = stub(ok(ME), ok(USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    await waitFor(() => expect(screen.getByText("$12.50")).toBeInTheDocument());
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /your bedrock usage/i }),
    ).toBeInTheDocument();
    expect(urls).toContain(
      "/api/me/usage?dateFrom=2026-01-11&dateTo=2026-01-20",
    );
  });

  it("shows a skeleton and no figures while the requests are pending", () => {
    stub(NEVER, NEVER);
    const view = renderWithProviders(MePage());
    expect(
      view.container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("$12.50")).not.toBeInTheDocument();
  });

  it("shows an empty state, not an error, when no usage matches the identities", async () => {
    stub(ok(ME), ok(EMPTY_USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    expect(
      await screen.findByText(/no bedrock usage/i, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it('shows "Ask your team lead for access" with the usage for a viewer with no team', async () => {
    stub(
      ok({ ...ME, memberTeamId: null, memberTeamVisible: false }),
      ok(USAGE),
    );
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    expect(
      await screen.findByText(/ask your team lead for access/i),
    ).toBeInTheDocument();
    expect(await screen.findByText("$12.50")).toBeInTheDocument();
  });

  it("does not show the no-team prompt to someone with a member team, an admin scope or a global role", async () => {
    for (const me of [
      ME,
      { ...ME, memberTeamId: null, teamScopes: ["team-a"] },
      { ...ME, memberTeamId: null, departmentScopes: ["dept-eng"] },
      { ...ME, memberTeamId: null, global: true },
    ]) {
      stub(ok(me), ok(USAGE));
      const view = renderWithProviders(await Promise.resolve(MePage()), {
        searchParams: RANGE,
      });
      await screen.findByText("$12.50");
      expect(
        screen.queryByText(/ask your team lead for access/i),
      ).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("shows a neutral not-visible notice, never a zero, when the member's team is hidden", async () => {
    stub(ok({ ...ME, memberTeamVisible: false }), ok(USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    expect(await screen.findByText(/not visible/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/ask your team lead for access/i),
    ).not.toBeInTheDocument();
  });

  it("contains a failing request in an alert instead of breaking the page (Rule 40.4)", async () => {
    stub(ok(ME), () => Promise.resolve(apiError(500)));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
  });

  // Slice B1, B1-12 / Design System - Layout, Page frame: a PageHeader
  // description sits at the top of the page shell, rendered before any data
  // resolves; the h1 stays in the top bar.
  it("starts with a PageHeader description, before the requests resolve, and no page-level h1", () => {
    stub(NEVER, NEVER);
    const view = renderWithProviders(MePage());

    const description = view.container.querySelector("p");
    expect(description?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});
