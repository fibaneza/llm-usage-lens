import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Rule 10.3 / 50.3 (identity and roles resolved on the server and
// passed down), "Recent authentication" (Server Actions beside the sign-in
// actions perform the step-up; the page hands them to the client as props),
// design-system "Settings Page". Module under test: `app/dashboard/settings/
// page.tsx`, which now also passes
//   access={{ viewer, stepUp: { entra, credentials } }}
// to SettingsContent when `loadSettingsAccessViewer(session)`
// (`@/lib/auth/settings-access`) returns a viewer, with the two Server Actions
// exported from the 'use server' module `./step-up-actions`
// (`stepUpWithEntra`, `stepUpWithCredentials`). Existing props (`isAdmin`) are
// unchanged (page.test.tsx).
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));

const loadViewer = vi.fn();
vi.mock("@/lib/auth/settings-access", () => ({
  loadSettingsAccessViewer: (session: unknown) => loadViewer(session),
}));

const stepUpWithEntra = vi.fn();
const stepUpWithCredentials = vi.fn();
const stepUpWithDevLogin = vi.fn();
vi.mock("./step-up-actions", () => ({
  stepUpWithEntra: (...args: unknown[]) => stepUpWithEntra(...args),
  stepUpWithCredentials: (...args: unknown[]) => stepUpWithCredentials(...args),
  stepUpWithDevLogin: (...args: unknown[]) => stepUpWithDevLogin(...args),
}));

type Props = {
  isAdmin: boolean;
  access?: {
    viewer: unknown;
    stepUp: { entra: unknown; credentials: unknown; devLogin: unknown };
  };
};
const content = vi.fn((props: Props) => (
  <div data-testid="content">{String(props.isAdmin)}</div>
));
vi.mock("@/components/settings/SettingsContent", () => ({
  SettingsContent: (props: Props) => content(props),
}));

import SettingsPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

const VIEWER = {
  roles: ["internal-auditor"],
  authMethod: "entra",
  adminScopes: [],
};

describe("SettingsPage - access sections", () => {
  it("passes the resolved viewer and the two step-up actions", async () => {
    const session = { user: { oid: "oid-1", roles: ["internal-auditor"] } };
    auth.mockResolvedValue(session);
    loadViewer.mockResolvedValue(VIEWER);
    render(await SettingsPage());
    expect(screen.getByTestId("content")).toBeInTheDocument();
    expect(loadViewer).toHaveBeenCalledWith(session);
    const props = content.mock.calls[0]?.[0];
    expect(props?.access?.viewer).toEqual(VIEWER);
    const stepUp = props?.access?.stepUp as
      | { entra: () => Promise<void>; credentials: (fd: FormData) => unknown }
      | undefined;
    expect(typeof stepUp?.entra).toBe("function");
    expect(typeof stepUp?.credentials).toBe("function");
    // B3: a dev-login session has its own step-up path.
    expect(typeof (stepUp as { devLogin?: unknown })?.devLogin).toBe(
      "function",
    );
    expect(stepUpWithEntra).not.toHaveBeenCalled();
    await stepUp?.entra();
    expect(stepUpWithEntra).toHaveBeenCalledTimes(1);
    const form = new FormData();
    await stepUp?.credentials(form);
    expect(stepUpWithCredentials).toHaveBeenCalledTimes(1);
    expect(stepUpWithCredentials.mock.calls[0]?.[0]).toBe(form);
  });

  it("passes no access prop when no viewer can be built", async () => {
    auth.mockResolvedValue({ user: { oid: "oid-1", roles: [] } });
    loadViewer.mockResolvedValue(undefined);
    render(await SettingsPage());
    expect(content.mock.calls[0]?.[0]?.access).toBeUndefined();
  });

  // 4R.4 review B1: `isAdmin` is the same effective-role answer the viewer
  // carries (claim + in-app grants, resolved per request on the server).
  it("isAdmin follows the viewer's effective roles: a grant-only admin has isAdmin=true", async () => {
    auth.mockResolvedValue({
      user: { oid: "oid-1", roles: [], authMethod: "password" },
    });
    loadViewer.mockResolvedValue({
      ...VIEWER,
      authMethod: "password",
      roles: ["internal-admin"],
    });
    render(await SettingsPage());
    expect(content.mock.calls[0]?.[0]?.isAdmin).toBe(true);
  });

  it("isAdmin is false when neither the claim nor the viewer holds internal-admin", async () => {
    auth.mockResolvedValue({
      user: { oid: "oid-1", roles: ["internal-auditor"], authMethod: "entra" },
    });
    loadViewer.mockResolvedValue(VIEWER);
    render(await SettingsPage());
    expect(content.mock.calls[0]?.[0]?.isAdmin).toBe(false);
  });

  it("keeps isAdmin separate from the viewer", async () => {
    auth.mockResolvedValue({
      user: { oid: "oid-1", roles: ["internal-admin"] },
    });
    loadViewer.mockResolvedValue({ ...VIEWER, roles: ["internal-admin"] });
    render(await SettingsPage());
    expect(content.mock.calls[0]?.[0]?.isAdmin).toBe(true);
  });
});
