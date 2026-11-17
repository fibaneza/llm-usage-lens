import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NavScope } from "@/lib/nav";
import { CommandMenu } from "./CommandMenu";

const mockPush = vi.fn<(href: string) => void>();
const mockUseSearchParams = vi.fn<() => URLSearchParams>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockUseSearchParams(),
}));

// Fail closed (Design System - Layout; Rule 10.3): a bare render is the
// non-global view, so the quick-jump tests below that need Usage items pass a
// global scope explicitly.
const GLOBAL: NavScope = {
  global: true,
  memberTeamId: null,
  teamScopes: new Set<string>(),
  departmentScopes: new Set<string>(),
};

describe("CommandMenu", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
  });

  it("renders a search trigger with the ⌘K hint", () => {
    render(<CommandMenu scope={GLOBAL} />);

    expect(screen.getByText("Search…")).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("opens the dialog when the trigger is clicked", async () => {
    const user = userEvent.setup();
    render(<CommandMenu scope={GLOBAL} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /search/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the dialog on Cmd+K", async () => {
    const user = userEvent.setup();
    render(<CommandMenu scope={GLOBAL} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.keyboard("{Meta>}k{/Meta}");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the dialog on Ctrl+K", async () => {
    const user = userEvent.setup();
    render(<CommandMenu scope={GLOBAL} />);

    await user.keyboard("{Control>}k{/Control}");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("navigates to Overview and closes when that item is selected", async () => {
    const user = userEvent.setup();
    render(<CommandMenu scope={GLOBAL} />);

    await user.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog");

    const overview = await screen.findByRole("option", { name: /overview/i });
    await user.click(overview);

    expect(mockPush).toHaveBeenCalledWith("/dashboard");
    expect(dialog).not.toBeInTheDocument();
  });

  // A second destination — guards against a hardcoded push("/dashboard").
  it("navigates to Cost by team when that item is selected", async () => {
    const user = userEvent.setup();
    render(<CommandMenu scope={GLOBAL} />);

    await user.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog");

    const teams = await screen.findByRole("option", {
      name: "Cost by team",
    });
    await user.click(teams);

    expect(mockPush).toHaveBeenCalledWith("/dashboard/teams");
    expect(mockPush).not.toHaveBeenCalledWith("/dashboard");
    expect(dialog).not.toBeInTheDocument();
  });

  // Verify-checklist: navigate between pages — a Services destination jump.
  it("navigates to Cost by service when that item is selected", async () => {
    const user = userEvent.setup();
    render(<CommandMenu scope={GLOBAL} />);

    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog");

    const services = await screen.findByRole("option", {
      name: "Cost by service",
    });
    await user.click(services);

    expect(mockPush).toHaveBeenCalledWith("/dashboard/services");
  });

  // Issue #75 — a quick-jump must carry the active date range, like the sidebar.
  it("carries the active date range onto the destination", async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-31"),
    );
    const user = userEvent.setup();
    render(<CommandMenu scope={GLOBAL} />);

    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog");

    const ranking = await screen.findByRole("option", { name: /ranking/i });
    await user.click(ranking);

    expect(mockPush).toHaveBeenCalledWith(
      "/dashboard/ranking?dateFrom=2026-01-01&dateTo=2026-01-31",
    );
  });

  it("toggles the dialog closed on a second Cmd+K", async () => {
    const user = userEvent.setup();
    render(<CommandMenu scope={GLOBAL} />);

    await user.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog");

    await user.keyboard("{Meta>}k{/Meta}");

    expect(dialog).not.toBeInTheDocument();
  });

  // Design System - Navigation (Sidebar): the sidebar, PageTitle and
  // CommandMenu share one filter, navGroupsFor (slice B1, B1-8); an item the
  // caller may not see is absent. Settings is one of the filtered items (B1-7),
  // not a separately appended entry.
  describe("shares the sidebar's filter", () => {
    const scope = (over: Partial<NavScope> = {}): NavScope => ({
      global: false,
      memberTeamId: null,
      teamScopes: new Set<string>(),
      departmentScopes: new Set<string>(),
      ...over,
    });
    const USAGE = [
      "Overview",
      "Ranking",
      "Cost by department",
      "Cost by team",
      "Cost by service",
      "Cost by user",
    ];

    async function optionNames(s?: NavScope) {
      const user = userEvent.setup();
      render(<CommandMenu scope={s} />);
      await user.keyboard("{Meta>}k{/Meta}");
      await screen.findByRole("dialog");
      return screen.getAllByRole("option").map((o) => o.textContent);
    }

    // Design System - Layout (fail closed); Rule 10.3: no scope is the
    // non-global view, never the full set.
    it("lists only the non-global destinations when no scope is given", async () => {
      expect(await optionNames()).toEqual(["My usage"]);
    });

    const ADMIN_FLAGS = {
      team: true,
      organisation: true,
      users: true,
      audit: true,
      settings: true,
    };

    it("lists the same destinations as the sidebar for an admin (B2-2)", async () => {
      expect(
        await optionNames(scope({ global: true, management: ADMIN_FLAGS })),
      ).toEqual([
        ...USAGE,
        "My usage",
        "Team",
        "Organisation",
        "Users",
        "Audit",
        "Settings",
      ]);
    });

    it("omits Audit for an org admin (B2-2)", async () => {
      expect(
        await optionNames(
          scope({
            global: true,
            management: { ...ADMIN_FLAGS, audit: false },
          }),
        ),
      ).toEqual([
        ...USAGE,
        "My usage",
        "Team",
        "Organisation",
        "Users",
        "Settings",
      ]);
    });

    it("lists only My usage for a user (B1-14, B2-2)", async () => {
      expect(await optionNames(scope({ memberTeamId: "team-a" }))).toEqual([
        "My usage",
      ]);
    });

    it("lists My usage and Team for a lead (B2-2)", async () => {
      expect(
        await optionNames(
          scope({
            teamScopes: new Set(["team-a"]),
            management: {
              team: true,
              organisation: false,
              users: false,
              audit: false,
              settings: false,
            },
          }),
        ),
      ).toEqual(["My usage", "Team"]);
    });

    it("opens a destination from the filtered list with the date range carried", async () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-31"),
      );
      const user = userEvent.setup();
      render(<CommandMenu scope={scope({ memberTeamId: "team-a" })} />);
      await user.keyboard("{Meta>}k{/Meta}");
      await screen.findByRole("dialog");

      await user.click(await screen.findByRole("option", { name: "My usage" }));

      expect(mockPush).toHaveBeenCalledWith(
        "/dashboard/me?dateFrom=2026-01-01&dateTo=2026-01-31",
      );
    });
  });
});
