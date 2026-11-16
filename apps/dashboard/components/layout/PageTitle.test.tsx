import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PageTitle } from "./PageTitle";

const mockUsePathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({ usePathname: () => mockUsePathname() }));

// Sources: Design System - Account Page (line 488: "The top-bar h1 reads
// 'Account'"; the route has no rail item, Navigation (Sidebar) table row
// "Account | Account | /dashboard/account"); Navigation (Sidebar) page titles
// (B1-5): a nav route's h1 is its pageTitle, nested routes included.
describe("PageTitle", () => {
  beforeEach(() => mockUsePathname.mockReset());

  it.each([
    ["/dashboard/account", "Account"],
    ["/dashboard/teams/team-1", "Cost by team"],
    ["/dashboard/me", "My usage"],
  ])("%s reads %s as the page h1", (path, title) => {
    mockUsePathname.mockReturnValue(path);
    render(<PageTitle />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
  });
});
