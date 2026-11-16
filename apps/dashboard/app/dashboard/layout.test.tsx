import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DashboardLayout from "./layout";

// Source: Rules 40.4 and 60.12 (a failing section never breaks the page; every
// page still enforces access itself), Rule 60.17 (no silent failures: the error
// reaches OpenTelemetry), Phase 4R.5 review round 2 D2; Design System -
// Navigation (Sidebar) (slice B1). When the authorization read fails the layout
// fails closed: it passes the no-team (non-global) scope, so the rail shows
// Usage (My usage only, B1-14), Management (LiteLLM) and Administration
// (Settings), never the six organisation-level Usage items or the full NAV_GROUPS.
const recordException = vi.fn();
vi.mock("@opentelemetry/api", () => ({
  trace: { getActiveSpan: () => ({ recordException }) },
}));
const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
const scopeForMock = vi.fn();
vi.mock("@/lib/api/scoped-rollups", () => ({
  scopeFor: (...args: unknown[]) => scopeForMock(...args),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));
// The real AppSidebar renders, so the assertions read the nav the user sees.
// Only the header is stubbed; it exposes the scope it receives.
vi.mock("@/components/layout/AppHeader", () => ({
  AppHeader: ({
    scope,
  }: {
    scope?: {
      global: boolean;
      memberTeamId: string | null;
      teamScopes: ReadonlySet<string>;
      departmentScopes: ReadonlySet<string>;
    };
  }) => (
    <header
      data-testid="header"
      data-scope={
        scope === undefined
          ? "none"
          : JSON.stringify({
              global: scope.global,
              memberTeamId: scope.memberTeamId,
              teamScopes: [...scope.teamScopes],
              departmentScopes: [...scope.departmentScopes],
            })
      }
    >
      header
    </header>
  ),
}));

const NO_TEAM_HEADER_SCOPE = JSON.stringify({
  global: false,
  memberTeamId: null,
  teamScopes: [],
  departmentScopes: [],
});
const link = (name: string) => screen.queryByRole("link", { name });
const GATED = [
  "Overview",
  "Ranking",
  "Cost by department",
  "Cost by team",
  "Cost by service",
  "Cost by user",
];
function expectNoTeamRail() {
  expect(link("My usage")).toBeInTheDocument();
  expect(link("LiteLLM")).toBeInTheDocument();
  expect(link("Settings")).toBeInTheDocument();
  for (const name of GATED) expect(link(name), name).not.toBeInTheDocument();
  expect(screen.getByTestId("header")).toHaveAttribute(
    "data-scope",
    NO_TEAM_HEADER_SCOPE,
  );
}

beforeEach(() => {
  recordException.mockClear();
  authMock.mockReset();
  scopeForMock.mockReset();
});

describe("DashboardLayout authorization read failure (review round 2, D2)", () => {
  it("fails closed to the no-team rail, and records the error, when scopeFor throws", async () => {
    authMock.mockResolvedValue({ user: { oid: "u", roles: [] } });
    const failure = new Error("dynamodb down");
    scopeForMock.mockRejectedValue(failure);

    render(await DashboardLayout({ children: <p>page body</p> }));

    expect(screen.getByText("page body")).toBeInTheDocument();
    expectNoTeamRail();
    expect(recordException).toHaveBeenCalledWith(failure);
  });

  it("fails closed to the no-team rail, and records the error, when auth() throws", async () => {
    const failure = new Error("auth store down");
    authMock.mockRejectedValue(failure);

    render(await DashboardLayout({ children: <p>page body</p> }));

    expect(screen.getByText("page body")).toBeInTheDocument();
    expectNoTeamRail();
    expect(recordException).toHaveBeenCalledWith(failure);
  });

  it("leaves the signed-out path unchanged: no read, no error, unscoped rail", async () => {
    authMock.mockResolvedValue(null);

    render(await DashboardLayout({ children: <p>page body</p> }));

    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(scopeForMock).not.toHaveBeenCalled();
    expect(recordException).not.toHaveBeenCalled();
    expect(screen.getByTestId("header")).toHaveAttribute("data-scope", "none");
    for (const name of [
      "My usage",
      "Overview",
      "Ranking",
      "Cost by team",
      "LiteLLM",
      "Settings",
    ]) {
      expect(link(name), name).toBeInTheDocument();
    }
  });
});
