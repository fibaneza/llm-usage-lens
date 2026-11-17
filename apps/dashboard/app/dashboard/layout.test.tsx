import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DashboardLayout from "./layout";

// Source: Rules 40.4 and 60.12 (a failing section never breaks the page; every
// page still enforces access itself), Rule 60.17 (no silent failures: the error
// reaches OpenTelemetry), Phase 4R.5 review round 2 D2; Design System -
// Navigation (Sidebar) (slice B1). When the authorization read fails the layout
// fails closed: it passes the no-team (non-global) scope with no management
// flags, so the rail shows Usage (My usage only, B1-14) and nothing else
// (slice B2, B2-2), never the six organisation-level Usage items or NAV_GROUPS.
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
// B2-1 / B2-2: the layout asks the one capability function for the Management
// and Settings flags and hands them to the client nav; audit shows when either
// source is readable.
const manageMock = vi.fn();
vi.mock("@/lib/manage-access", () => ({
  managementAccessFor: (...args: unknown[]) => manageMock(...args),
}));
const FLAGS_NONE = {
  global: false,
  team: false,
  organisation: false,
  users: false,
  audit: { app: false, gateway: false },
  settings: false,
};
const FLAGS_LEAD = { ...FLAGS_NONE, team: true };
const FLAGS_ADMIN = {
  global: true,
  team: true,
  organisation: true,
  users: true,
  audit: { app: true, gateway: true },
  settings: true,
};
const GLOBAL_SCOPE = {
  global: true,
  memberTeamId: null,
  teamScopes: new Set<string>(),
  departmentScopes: new Set<string>(),
};
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
const MANAGEMENT_LINKS = ["Team", "Organisation", "Users", "Audit", "Settings"];
function expectNoTeamRail() {
  expect(link("My usage")).toBeInTheDocument();
  for (const name of [...GATED, ...MANAGEMENT_LINKS, "LiteLLM"]) {
    expect(link(name), name).not.toBeInTheDocument();
  }
  expect(screen.getByTestId("header")).toHaveAttribute(
    "data-scope",
    NO_TEAM_HEADER_SCOPE,
  );
}

beforeEach(() => {
  recordException.mockClear();
  authMock.mockReset();
  scopeForMock.mockReset();
  manageMock.mockReset();
  manageMock.mockResolvedValue(FLAGS_NONE);
});

// B2-1 / B2-2: the rail is the capability function's answer, per role.
describe("DashboardLayout management navigation (B2-1, B2-2)", () => {
  it("an admin's rail lists the four Management pages and Settings", async () => {
    authMock.mockResolvedValue({ user: { oid: "u", roles: [] } });
    scopeForMock.mockResolvedValue(GLOBAL_SCOPE);
    manageMock.mockResolvedValue(FLAGS_ADMIN);

    render(await DashboardLayout({ children: <p>page body</p> }));

    for (const name of ["Overview", ...MANAGEMENT_LINKS]) {
      expect(link(name), name).toBeInTheDocument();
    }
    expect(link("LiteLLM")).not.toBeInTheDocument();
  });

  it("a lead's rail lists My usage and Team, with no Settings", async () => {
    authMock.mockResolvedValue({ user: { oid: "u", roles: [] } });
    scopeForMock.mockResolvedValue({
      ...GLOBAL_SCOPE,
      global: false,
      teamScopes: new Set(["team-a"]),
    });
    manageMock.mockResolvedValue(FLAGS_LEAD);

    render(await DashboardLayout({ children: <p>page body</p> }));

    expect(link("My usage")).toBeInTheDocument();
    expect(link("Team")).toBeInTheDocument();
    for (const name of ["Organisation", "Users", "Audit", "Settings"]) {
      expect(link(name), name).not.toBeInTheDocument();
    }
  });

  it("Audit shows when only one audit source is readable", async () => {
    authMock.mockResolvedValue({ user: { oid: "u", roles: [] } });
    scopeForMock.mockResolvedValue(GLOBAL_SCOPE);
    manageMock.mockResolvedValue({
      ...FLAGS_ADMIN,
      audit: { app: false, gateway: true },
    });

    render(await DashboardLayout({ children: <p>page body</p> }));

    expect(link("Audit")).toBeInTheDocument();
  });

  it("fails closed to My usage only, and records the error, when the capability read throws", async () => {
    authMock.mockResolvedValue({ user: { oid: "u", roles: [] } });
    scopeForMock.mockResolvedValue(GLOBAL_SCOPE);
    const failure = new Error("capability read down");
    manageMock.mockRejectedValue(failure);

    render(await DashboardLayout({ children: <p>page body</p> }));

    for (const name of MANAGEMENT_LINKS) {
      expect(link(name), name).not.toBeInTheDocument();
    }
    expect(recordException).toHaveBeenCalledWith(failure);
  });
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
    // Goal 2.3 / B1 W2 fail-closed: no scope is the non-global view.
    expect(link("My usage")).toBeInTheDocument();
    for (const name of [
      "Overview",
      "Ranking",
      "Cost by team",
      "Team",
      "Audit",
      "Settings",
    ]) {
      expect(
        screen.queryByRole("link", { name }),
        name,
      ).not.toBeInTheDocument();
    }
  });
});
