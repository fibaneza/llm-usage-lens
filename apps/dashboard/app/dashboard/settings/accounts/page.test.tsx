import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Source: System Architecture -- Authentication & Access (Account-mutation
// role); Rules 50.3, 60.7, 10.3; Design System "Settings Page" (unit D: the AWS
// accounts tab, visible to everyone with Settings). Module under test:
// `app/dashboard/settings/accounts/page.tsx`, an async Server Component that
// calls `auth()`, resolves the viewer and renders
// `<AccountsTab isAdmin={boolean} />`. Moved from the old settings
// page.test.tsx / page.access.test.tsx: the isAdmin assertions (claim-only
// admin, non-admin, no session, grant-only admin B1, auditor false, separate
// from the viewer).
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
const loadViewer = vi.fn();
vi.mock("@/lib/auth/settings-access", () => ({
  loadSettingsAccessViewer: (session: unknown) => loadViewer(session),
}));
const tab = vi.fn((props: { isAdmin: boolean }) => (
  <div data-testid="tab">{String(props.isAdmin)}</div>
));
vi.mock("@/components/settings/AccountsTab", () => ({
  AccountsTab: (props: { isAdmin: boolean }) => tab(props),
}));

// Slice B2 B2-10: the gate matrix lives in the manage-routes integration test.
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});

import AccountsPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

const viewer = (roles: string[]) => ({
  roles,
  authMethod: "entra",
  adminScopes: [],
});

describe("AccountsPage", () => {
  it("passes isAdmin=true for a session with the Admin role", async () => {
    auth.mockResolvedValue({
      user: { oid: "oid-test", roles: ["internal-admin"] },
    });
    loadViewer.mockResolvedValue(undefined);
    render(await AccountsPage());
    expect(screen.getByTestId("tab")).toHaveTextContent("true");
  });

  it("passes isAdmin=false without the Admin role", async () => {
    auth.mockResolvedValue({ user: { oid: "oid-test", roles: ["Reader"] } });
    loadViewer.mockResolvedValue(undefined);
    render(await AccountsPage());
    expect(screen.getByTestId("tab")).toHaveTextContent("false");
  });

  it("passes isAdmin=false without a session", async () => {
    auth.mockResolvedValue(null);
    loadViewer.mockResolvedValue(undefined);
    render(await AccountsPage());
    expect(screen.getByTestId("tab")).toHaveTextContent("false");
  });

  // 4R.4 review B1: isAdmin is the effective-role answer the viewer carries
  // (claim plus in-app grants, resolved per request on the server).
  it("a grant-only admin (viewer holds internal-admin) has isAdmin=true", async () => {
    auth.mockResolvedValue({
      user: { oid: "oid-1", roles: [], authMethod: "password" },
    });
    loadViewer.mockResolvedValue({
      ...viewer(["internal-admin"]),
      authMethod: "password",
    });
    render(await AccountsPage());
    expect(screen.getByTestId("tab")).toHaveTextContent("true");
  });

  it("isAdmin is false when the viewer is an auditor", async () => {
    auth.mockResolvedValue({
      user: { oid: "oid-1", roles: ["internal-auditor"], authMethod: "entra" },
    });
    loadViewer.mockResolvedValue(viewer(["internal-auditor"]));
    render(await AccountsPage());
    expect(screen.getByTestId("tab")).toHaveTextContent("false");
  });
});
