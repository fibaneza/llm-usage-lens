import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandMenu } from "./CommandMenu";

const mockPush = vi.fn<(href: string) => void>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("CommandMenu", () => {
  beforeEach(() => {
    mockPush.mockClear();
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

  it("toggles the dialog closed on a second Cmd+K", async () => {
    const user = userEvent.setup();
    render(<CommandMenu />);

    await user.keyboard("{Meta>}k{/Meta}");
    const dialog = await screen.findByRole("dialog");

    await user.keyboard("{Meta>}k{/Meta}");

    expect(dialog).not.toBeInTheDocument();
  });
});
