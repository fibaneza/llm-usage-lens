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

  it("a session that builds no viewer still lands on the registry", async () => {
    auth.mockResolvedValue(null);
    loadViewer.mockResolvedValue(undefined);
    await expect(SettingsIndexPage()).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/settings/accounts",
    );
  });
});
