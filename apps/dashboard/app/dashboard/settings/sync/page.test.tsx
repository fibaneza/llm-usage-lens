import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Source: Design System "Settings Page" (unit D, 2026-11-16): the Sync and data
// tab is visible to everyone with Settings. Module under test:
// `app/dashboard/settings/sync/page.tsx` - renders `<SyncTab />`, no props.
// Slice B2 B2-10: every tab page gates itself on the `settings` capability; the
// gate matrix runs in app/dashboard/__tests__/manage-routes.integration.test.ts.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});
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
