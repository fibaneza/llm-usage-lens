import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import type { NavScope } from "@/lib/nav";
import { AppSidebar, AppSidebarFallback } from "./AppSidebar";

const mockUsePathname = vi.fn<() => string>();
const mockUseSearchParams = vi.fn<() => URLSearchParams>();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useSearchParams: () => mockUseSearchParams(),
}));

// A global admin: every Usage item, every Management item and Settings
// (Access Control - Navigation and landing by role, matrix; B2-2).
const FULL_SCOPE: NavScope = {
  global: true,
  memberTeamId: null,
  teamScopes: new Set<string>(),
  departmentScopes: new Set<string>(),
  management: {
    team: true,
    teamUsage: true,
    litellm: true,
    users: true,
    audit: true,
    settings: true,
  },
};

function renderSidebar(
  pathname: string,
  search = "",
  scope: NavScope = FULL_SCOPE,
) {
  mockUsePathname.mockReturnValue(pathname);
  mockUseSearchParams.mockReturnValue(new URLSearchParams(search));
  return render(
    <SidebarProvider>
      <AppSidebar scope={scope} />
    </SidebarProvider>,
  );
}

function renderBareSidebar(pathname: string) {
  mockUsePathname.mockReturnValue(pathname);
  mockUseSearchParams.mockReturnValue(new URLSearchParams());
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

function renderRail(defaultOpen: boolean) {
  mockUsePathname.mockReturnValue("/dashboard");
  mockUseSearchParams.mockReturnValue(new URLSearchParams());
  return render(
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar scope={FULL_SCOPE} />
    </SidebarProvider>,
  );
}

// Design System - Navigation (Sidebar): the full set a bare render (no scope)
// shows; the Usage breakdowns read "Cost by ..." (unique labels, B1-5).
// Management improvements M1 (MI-D1): My usage second; Management = Users,
// Team, LiteLLM, Audit. Team usage stays hidden for every role until unit M2
// builds its page (coordinator ruling, M1), so it is not in this set.
const NAV_TITLES = [
  "Overview",
  "My usage",
  "Ranking",
  "Cost by department",
  "Cost by team",
  "Cost by service",
  "Cost by user",
  "Users",
  "Team",
  "LiteLLM",
  "Audit",
  "Settings",
];

// System Architecture - "Configuration file" (Moved environment values: the
// server resolves display.orgName > deprecated NEXT_PUBLIC_ORG_NAME > default
// and passes it to the top bar as a prop), A10.
describe("AppSidebar organisation name (unit CFG)", () => {
  it("shows the orgName prop", () => {
    mockUsePathname.mockReturnValue("/dashboard");
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    render(
      <SidebarProvider>
        <AppSidebar orgName="Acme Corp" />
      </SidebarProvider>,
    );
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });

  it("the pre-hydration fallback shows the same name", () => {
    render(
      <SidebarProvider>
        <AppSidebarFallback orgName="Acme Corp" />
      </SidebarProvider>,
    );
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
  });
});

describe("AppSidebar", () => {
  it("renders all twelve navigation links for a global admin scope", () => {
    renderSidebar("/dashboard");

    for (const title of NAV_TITLES) {
      expect(screen.getByRole("link", { name: title })).toBeInTheDocument();
    }
  });

  // B2-2 / goal 2.3: with no scope the rail fails closed to the non-global
  // view (as CommandMenu does): Usage -> My usage only, no Management group,
  // no Settings. Pages enforce access regardless.
  it("with no scope shows only My usage: no Management items, no Settings", () => {
    const { container } = renderBareSidebar("/dashboard");

    expect(screen.getByRole("link", { name: "My usage" })).toBeInTheDocument();
    for (const title of NAV_TITLES.filter((t) => t !== "My usage")) {
      expect(
        screen.queryByRole("link", { name: title }),
      ).not.toBeInTheDocument();
    }
    const labels = [
      ...container.querySelectorAll('[data-slot="sidebar-group-label"]'),
    ].map((el) => el.textContent);
    expect(labels).toEqual(["Usage"]);
  });

  // W3 (round-1 review): the primary nav landmark is named so the e2e specs and
  // screen readers can address it; Rule 60.30.
  it("exposes the nav items in a navigation landmark named Primary", () => {
    renderSidebar("/dashboard");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Overview" })).toBeVisible();
    expect(within(nav).getByRole("link", { name: "Settings" })).toBeVisible();
  });

  it("marks the link for the active nested route, not Overview", () => {
    renderSidebar("/dashboard/teams/team-123");

    expect(screen.getByRole("link", { name: "Cost by team" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("activates Overview only on the exact dashboard root", () => {
    renderSidebar("/dashboard");

    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  // Issue #75 — the global date range must survive navigation between menus.
  it("carries the active date range onto every navigation link", () => {
    renderSidebar("/dashboard", "dateFrom=2026-01-01&dateTo=2026-01-31");

    for (const title of NAV_TITLES) {
      expect(screen.getByRole("link", { name: title })).toHaveAttribute(
        "href",
        expect.stringContaining("dateFrom=2026-01-01&dateTo=2026-01-31"),
      );
    }
  });

  it("leaves hrefs clean when no date range is in the URL", () => {
    renderSidebar("/dashboard");

    expect(screen.getByRole("link", { name: "Ranking" })).toHaveAttribute(
      "href",
      "/dashboard/ranking",
    );
  });

  it("renders a collapse toggle in the footer", () => {
    renderSidebar("/dashboard");

    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });
});

// Design System - Navigation (Sidebar): nav is grouped Usage, Management,
// Administration; Settings lives in Administration, last, and the footer holds
// only the collapse icon button (slice B1, B1-5).
describe("AppSidebar - groups (Usage / Management / Administration)", () => {
  const groupLabels = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-slot="sidebar-group-label"]')].map(
      (el) => el.textContent,
    );
  const group = (container: HTMLElement, label: string) => {
    const el = [...container.querySelectorAll('[data-slot="sidebar-group"]')]
      .filter(
        (g) =>
          g.querySelector('[data-slot="sidebar-group-label"]')?.textContent ===
          label,
      )
      .at(0);
    if (!(el instanceof HTMLElement)) throw new Error(`no group ${label}`);
    return el;
  };

  it("labels three groups, in order, and drops the pre-B1 labels", () => {
    const { container } = renderSidebar("/dashboard");

    expect(groupLabels(container)).toEqual([
      "Usage",
      "Management",
      "Administration",
    ]);
    for (const old of ["Main", "Attribution", "Gateway"]) {
      expect(screen.queryByText(old)).not.toBeInTheDocument();
    }
  });

  it("places the Usage items (My usage second), the four Management pages (Users, Team, LiteLLM, Audit), and Settings in their groups (MI-D1)", () => {
    const { container } = renderSidebar("/dashboard");

    expect(
      within(group(container, "Usage"))
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual([
      "Overview",
      "My usage",
      "Ranking",
      "Cost by department",
      "Cost by team",
      "Cost by service",
      "Cost by user",
    ]);
    expect(
      within(group(container, "Management"))
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      ["Users", "/dashboard/manage/users"],
      ["Team", "/dashboard/manage/team"],
      ["LiteLLM", "/dashboard/manage/litellm"],
      ["Audit", "/dashboard/manage/audit"],
    ]);
    expect(
      within(group(container, "Administration"))
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Settings"]);
  });

  it("keeps Settings out of the footer, which holds only the collapse button", () => {
    const { container } = renderSidebar("/dashboard");
    const footer = container.querySelector('[data-slot="sidebar-footer"]');
    if (!(footer instanceof HTMLElement)) throw new Error("no footer");

    expect(within(footer).queryAllByRole("link")).toHaveLength(0);
    expect(
      within(footer)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Collapse"]);
  });

  it("puts the Administration group last, after Management", () => {
    const { container } = renderSidebar("/dashboard");
    const follows = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(
      follows(
        group(container, "Management"),
        group(container, "Administration"),
      ),
    ).toBe(true);
    expect(
      follows(group(container, "Usage"), group(container, "Management")),
    ).toBe(true);
  });
});

// shadcn's icon rail: a tooltip names each link while the rail is collapsed to
// icons, and never while it is expanded (the label is already visible). Desktop
// viewport (jsdom default, >= md). Pointer-out dismissal depends on Radix's
// grace area, which needs real layout, so it is covered in e2e/sidebar.spec.ts.
describe("AppSidebar - rail tooltips", () => {
  it("names a link in a tooltip on hover when collapsed", async () => {
    const user = userEvent.setup();
    renderRail(false);

    await user.hover(screen.getByRole("link", { name: "Ranking" }));

    expect(
      await screen.findByRole("tooltip", { name: "Ranking" }),
    ).toBeInTheDocument();
  });

  it("names the collapse toggle Expand on hover when collapsed", async () => {
    const user = userEvent.setup();
    renderRail(false);

    await user.hover(screen.getByRole("button", { name: "Expand" }));

    expect(
      await screen.findByRole("tooltip", { name: "Expand" }),
    ).toBeInTheDocument();
  });

  it("names a link in a tooltip on keyboard focus and hides it on Escape", async () => {
    const user = userEvent.setup();
    renderRail(false);
    act(() => screen.getByRole("link", { name: "Overview" }).focus());

    await user.tab();

    expect(screen.getByRole("link", { name: "My usage" })).toHaveFocus();
    expect(
      await screen.findByRole("tooltip", { name: "My usage" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows no tooltip on hover when expanded", async () => {
    const user = userEvent.setup();
    renderRail(true);
    const link = screen.getByRole("link", { name: "Ranking" });

    await user.hover(link);

    // The hover registered on the trigger (Radix reflects it as data-state)...
    await waitFor(() =>
      expect(link.getAttribute("data-state")).toMatch(/-open$/),
    );
    // ...but the tooltip content stays hidden while the labels are visible.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows no tooltip on keyboard focus when expanded", async () => {
    const user = userEvent.setup();
    renderRail(true);
    act(() => screen.getByRole("link", { name: "Overview" }).focus());

    await user.tab();

    expect(screen.getByRole("link", { name: "My usage" })).toHaveFocus();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

// WCAG 4.1.2 Name, Role, Value (Rule 60.30): the footer toggle's accessible name
// must describe the action pressing it performs, not a fixed label. On the
// desktop rail that action flips with the rail state; the tooltip repeats the
// same word. useIsMobile reads window.innerWidth (md breakpoint is 768), so pin
// a wide desktop viewport (design-system - Layout, breakpoints).
describe("AppSidebar - rail toggle accessible name (desktop, 1440px)", () => {
  const originalWidth = window.innerWidth;

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1440,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalWidth,
    });
  });

  it("is named Collapse while the rail is expanded", () => {
    renderRail(true);

    expect(screen.getByRole("button", { name: "Collapse" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Expand" }),
    ).not.toBeInTheDocument();
  });

  it("is named Expand while the rail is collapsed to icons", () => {
    renderRail(false);

    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Collapse" }),
    ).not.toBeInTheDocument();
  });

  it("repeats its accessible name in the tooltip when collapsed", async () => {
    const user = userEvent.setup();
    renderRail(false);
    const toggle = screen.getByRole("button", { name: "Expand" });

    await user.hover(toggle);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(/^Expand$/);
    expect(toggle).toHaveAccessibleName("Expand");
  });

  it("shows no tooltip while expanded, so the visible label is the name", async () => {
    const user = userEvent.setup();
    renderRail(true);
    const toggle = screen.getByRole("button", { name: "Collapse" });

    await user.hover(toggle);

    await waitFor(() =>
      expect(toggle.getAttribute("data-state")).toMatch(/-open$/),
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renames itself with each press: Collapse, then Expand, then Collapse", async () => {
    const user = userEvent.setup();
    renderRail(true);

    await user.click(screen.getByRole("button", { name: "Collapse" }));

    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Collapse" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand" }));

    expect(screen.getByRole("button", { name: "Collapse" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Expand" }),
    ).not.toBeInTheDocument();
  });

  // Design System — Layout → Structure: the product name shown is "LLM Usage
  // Lens".
  it("brands the sidebar LLM Usage Lens, with the home link named accordingly", () => {
    renderSidebar("/dashboard");

    const brand = screen.getByRole("link", {
      name: "LLM Usage Lens — go to overview",
    });
    expect(brand).toHaveAttribute("href", "/dashboard");
    expect(brand).toHaveTextContent("LLM Usage Lens");
    expect(screen.queryByText("Bedrock Cost")).not.toBeInTheDocument();
  });
});

// Source: Design System - Navigation (Sidebar); Access Control MI-D2: the
// LiteLLM item opens the LiteLLM area; the Organisation item is gone. Team
// usage is hidden for every role while its page is unbuilt (coordinator
// ruling, M1; the flag is asserted in lib/manage-access*.test.ts).
describe("AppSidebar - LiteLLM item, no Organisation item, no Team usage yet", () => {
  it("links LiteLLM to the area and renders no Organisation link (MI-D2)", () => {
    renderSidebar("/dashboard");

    expect(screen.getByRole("link", { name: "LiteLLM" })).toHaveAttribute(
      "href",
      "/dashboard/manage/litellm",
    );
    expect(screen.queryByRole("link", { name: "Organisation" })).toBeNull();
    expect(
      document.querySelector('a[href^="/dashboard/manage/organisation"]'),
    ).toBeNull();
  });

  it("lights LiteLLM on its nested tab routes", () => {
    renderSidebar("/dashboard/manage/litellm/teams");

    expect(screen.getByRole("link", { name: "LiteLLM" })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("renders no Team usage link even for a caller whose teamUsage flag is true", () => {
    renderSidebar("/dashboard");

    expect(screen.queryByRole("link", { name: "Team usage" })).toBeNull();
    expect(
      document.querySelector('a[href^="/dashboard/team-usage"]'),
    ).toBeNull();
  });
});

// Design System - Navigation (Sidebar) ("hidden, never dead") and Access
// Control - Navigation and landing by role; slice B1 B1-1/B1-8: the sidebar
// renders navGroupsFor(scope); no scope means the non-global view (B2-2). The
// full per-role matrix is asserted once in lib/nav.test.ts; here only that the
// rendered rail follows the filter.
describe("AppSidebar - scope-filtered navigation", () => {
  const NONE = {
    team: false,
    teamUsage: false,
    litellm: false,
    users: false,
    audit: false,
    settings: false,
  };
  const scoped = (over: Partial<NavScope>): NavScope => ({
    global: false,
    memberTeamId: null,
    teamScopes: new Set<string>(),
    departmentScopes: new Set<string>(),
    management: NONE,
    ...over,
  });
  const labels = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-slot="sidebar-group-label"]')].map(
      (el) => el.textContent,
    );

  function renderScoped(scope: NavScope, search = "") {
    mockUsePathname.mockReturnValue("/dashboard/me");
    mockUseSearchParams.mockReturnValue(new URLSearchParams(search));
    return render(
      <SidebarProvider>
        <AppSidebar scope={scope} />
      </SidebarProvider>,
    );
  }

  const USAGE_LINKS = [
    "Overview",
    "Ranking",
    "Cost by department",
    "Cost by team",
    "Cost by service",
    "Cost by user",
  ];

  // B2-2: a user's rail is the Usage group with My usage only; the empty
  // Management and Administration groups are not rendered.
  it.each([
    ["a viewer with no team", scoped({})],
    ["a member", scoped({ memberTeamId: "team-a" })],
  ])("%s sees a Usage group with only My usage (B1-14, B2-2)", (_n, scope) => {
    const { container } = renderScoped(scope);

    expect(labels(container)).toEqual(["Usage"]);
    expect(screen.getByRole("link", { name: "My usage" })).toBeInTheDocument();
    for (const gone of [
      ...USAGE_LINKS,
      "Team",
      "Team usage",
      "LiteLLM",
      "Users",
      "Audit",
      "Settings",
    ]) {
      expect(screen.queryByRole("link", { name: gone })).toBeNull();
    }
  });

  // B2-2: a lead sees My usage and Team; Settings stays closed to it.
  it.each([
    [
      "a team lead",
      scoped({
        teamScopes: new Set(["team-a"]),
        management: { ...NONE, team: true, teamUsage: true },
      }),
    ],
    [
      "a department lead",
      scoped({
        departmentScopes: new Set(["dept-eng"]),
        management: { ...NONE, team: true, teamUsage: true },
      }),
    ],
  ])("%s sees My usage and Team only (B2-2)", (_n, scope) => {
    const { container } = renderScoped(scope);

    expect(labels(container)).toEqual(["Usage", "Management"]);
    expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute(
      "href",
      "/dashboard/manage/team",
    );
    for (const gone of ["LiteLLM", "Users", "Audit", "Settings"]) {
      expect(screen.queryByRole("link", { name: gone })).toBeNull();
    }
  });

  it("an org admin sees Management without Audit, and Settings", () => {
    const { container } = renderScoped(
      scoped({
        global: true,
        management: {
          team: true,
          teamUsage: true,
          litellm: true,
          users: true,
          audit: false,
          settings: true,
        },
      }),
    );

    expect(labels(container)).toEqual([
      "Usage",
      "Management",
      "Administration",
    ]);
    expect(screen.queryByRole("link", { name: "Audit" })).toBeNull();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("a scope that carries no management flags gets no Management item and no Settings (fail closed)", () => {
    const { container } = renderScoped({
      global: false,
      memberTeamId: null,
      teamScopes: new Set<string>(),
      departmentScopes: new Set<string>(),
    });

    expect(labels(container)).toEqual(["Usage"]);
  });

  it("a global admin sees the three groups with the Usage links, Overview at /dashboard", () => {
    const { container } = renderScoped(
      scoped({
        global: true,
        management: {
          team: true,
          teamUsage: true,
          litellm: true,
          users: true,
          audit: true,
          settings: true,
        },
      }),
    );

    expect(labels(container)).toEqual([
      "Usage",
      "Management",
      "Administration",
    ]);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("carries the date range onto Management and Settings links too (issue #75; global date range applies to every Management page)", () => {
    renderScoped(
      scoped({
        global: true,
        management: {
          team: true,
          teamUsage: true,
          litellm: true,
          users: true,
          audit: true,
          settings: true,
        },
      }),
      "dateFrom=2026-01-01&dateTo=2026-01-31",
    );

    for (const name of ["My usage", "Team", "Audit", "Settings"]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute(
        "href",
        expect.stringContaining("dateFrom=2026-01-01&dateTo=2026-01-31"),
      );
    }
  });
});
