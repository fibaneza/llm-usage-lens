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

// Slice B2: B2-9 (the layout opens with a PageHeader description above the
// route tabs; the h1 stays in the top bar - Design System - Layout, Page
// frame) and B2-10 (settings=false is the 404, since a layout is not re-run on
// soft navigation each page gates too; this is the layout's own gate).
const manage = await import("@/test/fakes/manage-access-fake");
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import SettingsLayout from "./layout";

afterEach(() => {
  vi.clearAllMocks();
  manage.resetManageAccess();
});

describe("SettingsLayout page frame and gate (B2-9, B2-10)", () => {
  it("opens with a one-line PageHeader description before the tab row, and no page-level h1", async () => {
    auth.mockResolvedValue({ user: { oid: "oid-1" } });
    loadViewer.mockResolvedValue({
      roles: ["internal-admin"],
      authMethod: "entra",
      adminScopes: [],
    });
    const { container } = render(
      await SettingsLayout({ children: <p>page body</p> }),
    );

    const description = container.querySelector("p");
    expect(description?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(description?.textContent).not.toBe("page body");
    expect(description).not.toBeNull();
    const position = (description as HTMLElement).compareDocumentPosition(
      screen.getByTestId("row"),
    );
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("renders the 404 when the caller may not see Settings (lead, user)", async () => {
    manage.setManageAccess({ settings: false, global: false });
    auth.mockResolvedValue({ user: { oid: "oid-1" } });
    loadViewer.mockResolvedValue(undefined);

    await expect(
      SettingsLayout({ children: <p>page body</p> }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
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
