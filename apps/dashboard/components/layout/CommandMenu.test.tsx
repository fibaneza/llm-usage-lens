import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandMenu } from "./CommandMenu";

const mockPush = vi.fn<(href: string) => void>();
const mockUseSearchParams = vi.fn<() => URLSearchParams>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockUseSearchParams(),
}));

describe("CommandMenu", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
  });

  it("renders a search trigger with the ⌘K hint", () => {
    render(<CommandMenu />);

    expect(screen.getByText("Search…")).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("opens the dialog when the trigger is clicked", async () => {
    const user = userEvent.setup();
    render(<CommandMenu />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /search/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the dialog on Cmd+K", async () => {
    const user = userEvent.setup();
    render(<CommandMenu />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.keyboard("{Meta>}k{/Meta}");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the dialog on Ctrl+K", async () => {
    const user = userEvent.setup();
    render(<CommandMenu />);

    await user.keyboard("{Control>}k{/Control}");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("navigates to Overview and closes when that item is selected", async () => {
    const user = userEvent.setup();
    render(<CommandMenu />);

    await user.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog");

    const overview = await screen.findByRole("option", { name: /overview/i });
    await user.click(overview);

    expect(mockPush).toHaveBeenCalledWith("/dashboard");
    expect(dialog).not.toBeInTheDocument();
  });

  // A second destination — guards against a hardcoded push("/dashboard").
  it("navigates to Teams when that item is selected", async () => {
    const user = userEvent.setup();
    render(<CommandMenu />);

    await user.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog");

    const teams = await screen.findByRole("option", { name: /teams/i });
    await user.click(teams);

    expect(mockPush).toHaveBeenCalledWith("/dashboard/teams");
    expect(mockPush).not.toHaveBeenCalledWith("/dashboard");
    expect(dialog).not.toBeInTheDocument();
  });

  // Verify-checklist: navigate between pages — a Services destination jump.
  it("navigates to Services when that item is selected", async () => {
    const user = userEvent.setup();
    render(<CommandMenu />);

    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog");

    const services = await screen.findByRole("option", { name: /services/i });
    await user.click(services);

    expect(mockPush).toHaveBeenCalledWith("/dashboard/services");
  });

  // Issue #75 — a quick-jump must carry the active date range, like the sidebar.
  it("carries the active date range onto the destination", async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams("dateFrom=2026-01-01&dateTo=2026-01-31"),
    );
    const user = userEvent.setup();
    render(<CommandMenu />);

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
    render(<CommandMenu />);

    await user.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog");

    await user.keyboard("{Meta>}k{/Meta}");

    expect(dialog).not.toBeInTheDocument();
  });

  // Phase 4R.5 / Design System - Access states and scoped labels (4R.5 review
  // UI-B3): a scoped caller's list leaves out out-of-scope destinations and its
  // Overview item is the ?view=overview link (a bare /dashboard redirects them).
  describe("for a scoped caller", () => {
    const scope = {
      global: false,
      memberTeamId: "team-a",
      teamScopes: new Set<string>(),
      departmentScopes: new Set<string>(),
    };

    it("lists only in-scope destinations and opens the scoped Overview link", async () => {
      const user = userEvent.setup();
      render(<CommandMenu scope={scope} />);

      await user.keyboard("{Meta>}k{/Meta}");
      await screen.findByRole("dialog");

      expect(
        screen.queryByRole("option", { name: "Departments" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: "Teams" }),
      ).not.toBeInTheDocument();
      expect(
        await screen.findByRole("option", { name: "My teams" }),
      ).toBeInTheDocument();

      await user.click(
        await screen.findByRole("option", { name: /overview/i }),
      );

      expect(mockPush).toHaveBeenCalledWith("/dashboard?view=overview");
    });

    it("lists only My usage and LiteLLM for a no-team viewer", async () => {
      const user = userEvent.setup();
      render(<CommandMenu scope={{ ...scope, memberTeamId: null }} />);

      await user.keyboard("{Meta>}k{/Meta}");
      await screen.findByRole("dialog");

      expect(screen.queryByRole("option", { name: /overview/i })).toBeNull();
      expect(screen.queryByRole("option", { name: /ranking/i })).toBeNull();
      expect(
        await screen.findByRole("option", { name: "My usage" }),
      ).toBeInTheDocument();
    });
  });
});
