import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Design System "Settings Page" (unit D, 2026-11-16): `/dashboard/
// settings` redirects on the server to the caller's first visible tab;
// implementation-phases unit D Verify. Module under test: the index
// `app/dashboard/settings/page.tsx`, an async Server Component that resolves
// the viewer (`auth()` + `loadSettingsAccessViewer`), computes
// `settingsTabsFor(viewer)` and calls `redirect(tabs[0].href)`. (The old
// page.test.tsx isAdmin assertions moved to accounts/page.test.tsx.)
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
const loadViewer = vi.fn();
vi.mock("@/lib/auth/settings-access", () => ({
  loadSettingsAccessViewer: (session: unknown) => loadViewer(session),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

// Slice B2 B2-10: the gate matrix lives in the manage-routes integration test.
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});

import SettingsIndexPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

describe("Settings index", () => {
  it.each([
    ["internal-admin", ["internal-admin"]],
    ["internal-auditor", ["internal-auditor"]],
    ["a viewer without a scope", ["internal-viewer"]],
  ])("%s is redirected to the first visible tab", async (_n, roles) => {
    auth.mockResolvedValue({ user: { oid: "oid-1", roles } });
    loadViewer.mockResolvedValue({
      roles,
      authMethod: "entra",
      adminScopes: [],
    });
    await expect(SettingsIndexPage()).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/settings/accounts",
    );
  });

  // Design System - Routes and redirects: the former Settings audit entry
  // `?section=audit` goes to Management -> Audit (slice B2, B2-3); the target's
  // own gate decides who sees it. `searchParams` is optional in the contract so
  // the calls above stay valid.
  it("?section=audit is redirected to Management -> Audit, any other section to the first tab", async () => {
    auth.mockResolvedValue({ user: { oid: "oid-1", roles: [] } });
    loadViewer.mockResolvedValue({
      roles: ["internal-admin"],
      authMethod: "entra",
      adminScopes: [],
    });
    await expect(
      SettingsIndexPage({
        searchParams: Promise.resolve({ section: "audit" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard/manage/audit");
    await expect(
      SettingsIndexPage({
        searchParams: Promise.resolve({ section: "access" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard/settings/accounts");
  });

  it("a session that builds no viewer still lands on the registry", async () => {
    auth.mockResolvedValue(null);
    loadViewer.mockResolvedValue(undefined);
    await expect(SettingsIndexPage()).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/settings/accounts",
    );
  });
});
