import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DashboardLayout from "./layout";

// Source: Rules 40.4 and 60.12 (a failing section never breaks the page; every
// page still enforces access itself), Rule 60.17 (no silent failures: the error
// reaches OpenTelemetry), Phase 4R.5 review round 2 D2. When the authorization
// read fails the layout fails closed: it passes the no-team scope, so the rail
// shows only My usage and LiteLLM, never the full NAV_GROUPS.
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
  "My teams",
  "Teams",
  "Ranking",
  "Departments",
  "Services",
  "Users",
];
function expectNoTeamRail() {
  expect(link("My usage")).toBeInTheDocument();
  expect(link("LiteLLM")).toBeInTheDocument();
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
    for (const name of ["My usage", "Overview", "Ranking", "LiteLLM"]) {
      expect(link(name), name).toBeInTheDocument();
    }
  });
});
