import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Design System "Settings Page" (unit D, 2026-11-16): a tab row at the
// top of every Settings page showing only the tabs the caller can use, and the
// client hash resolver mounted for the old `#<slug>` links. Rule 60.10
// (authorization read per request). Module under test:
// `app/dashboard/settings/layout.tsx`, an async Server Component
// `SettingsLayout({ children })` rendering
//   <SettingsTabs tabs /> <SettingsHashResolver tabs /> {children}
// with `tabs = settingsTabsFor(viewer)`. Each tab page still authorizes itself
// (a layout alone is not re-run on soft navigation): see the page tests.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
const loadViewer = vi.fn();
vi.mock("@/lib/auth/settings-access", () => ({
  loadSettingsAccessViewer: (session: unknown) => loadViewer(session),
}));
type Tabs = { tabs: { id: string }[] };
vi.mock("@/components/settings/SettingsTabs", () => ({
  SettingsTabs: ({ tabs }: Tabs) => (
    <div data-testid="row">{tabs.map((t) => t.id).join(",")}</div>
  ),
}));
vi.mock("@/components/settings/SettingsHashResolver", () => ({
  SettingsHashResolver: ({ tabs }: Tabs) => (
    <div data-testid="resolver">{tabs.map((t) => t.id).join(",")}</div>
  ),
}));

import SettingsLayout from "./layout";

afterEach(() => {
  vi.clearAllMocks();
});

describe("SettingsLayout", () => {
  it("gives the row and the resolver the tabs of the resolved viewer, and renders the page", async () => {
    auth.mockResolvedValue({ user: { oid: "oid-1" } });
    loadViewer.mockResolvedValue({
      roles: ["internal-org-admin"],
      authMethod: "entra",
      adminScopes: [],
    });
    render(await SettingsLayout({ children: <p>page body</p> }));
    expect(screen.getByTestId("row")).toHaveTextContent(
      "accounts,sync,litellm,access",
    );
    expect(screen.getByTestId("resolver")).toHaveTextContent(
      "accounts,sync,litellm,access",
    );
    expect(screen.getByText("page body")).toBeInTheDocument();
  });

  it("a session that builds no viewer sees only the registry and sync tabs", async () => {
    auth.mockResolvedValue(null);
    loadViewer.mockResolvedValue(undefined);
    render(await SettingsLayout({ children: <p>page body</p> }));
    expect(screen.getByTestId("row")).toHaveTextContent("accounts,sync");
    expect(screen.getByTestId("row")).not.toHaveTextContent("access");
  });
});
