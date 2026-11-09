import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Source: System Architecture -- Authentication & Access (Account-mutation
// role); Rules 50.3, 60.7. The page is an async Server Component that calls
// `auth()` (from "@/auth"), derives admin via `hasAdminRole` and passes
// `isAdmin` to `SettingsContent`.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));

const content = vi.fn((props: { isAdmin: boolean }) => (
  <div data-testid="content">{String(props.isAdmin)}</div>
));
vi.mock("@/components/settings/SettingsContent", () => ({
  SettingsContent: (props: { isAdmin: boolean }) => content(props),
}));

import SettingsPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

describe("SettingsPage", () => {
  it("passes isAdmin=true for a session with the Admin role", async () => {
    auth.mockResolvedValue({ user: { roles: ["Admin"] } });
    render(await SettingsPage());
    expect(screen.getByTestId("content")).toHaveTextContent("true");
  });

  it("passes isAdmin=false without the Admin role", async () => {
    auth.mockResolvedValue({ user: { roles: ["Reader"] } });
    render(await SettingsPage());
    expect(screen.getByTestId("content")).toHaveTextContent("false");
  });

  it("passes isAdmin=false without a session", async () => {
    auth.mockResolvedValue(null);
    render(await SettingsPage());
    expect(screen.getByTestId("content")).toHaveTextContent("false");
  });
});
