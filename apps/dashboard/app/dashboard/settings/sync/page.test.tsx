import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Source: Design System "Settings Page" (unit D, 2026-11-16): the Sync and data
// tab is visible to everyone with Settings. Module under test:
// `app/dashboard/settings/sync/page.tsx` - renders `<SyncTab />`, no props.
vi.mock("@/components/settings/SyncTab", () => ({
  SyncTab: () => <div data-testid="tab" />,
}));

import SyncPage from "./page";

describe("SyncPage", () => {
  it("renders the Sync and data tab", async () => {
    render(await SyncPage());
    expect(screen.getByTestId("tab")).toBeInTheDocument();
  });
});
