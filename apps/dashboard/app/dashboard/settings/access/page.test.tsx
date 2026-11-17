import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Design System "Settings Page" - Access sub-tabs (unit D, 2026-11-16):
// `/dashboard/settings/access` redirects on the server to the first visible
// sub-tab; a caller with no visible sub-tab gets the same 404 as a missing
// page. Module under test: `app/dashboard/settings/access/page.tsx`.
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

import AccessIndexPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

function as(roles: string[], scoped = false) {
  auth.mockResolvedValue({ user: { oid: "oid-1", roles } });
  loadViewer.mockResolvedValue({
    roles,
    authMethod: "entra",
    adminScopes: scoped ? [{ scopeType: "team", scopeId: "team-pay" }] : [],
  });
}

describe("Access index", () => {
  it.each([
    ["internal-admin", ["internal-admin"], false],
    ["internal-org-admin", ["internal-org-admin"], false],
    ["internal-auditor", ["internal-auditor"], false],
    ["a team-scope admin", ["internal-viewer"], true],
  ])("%s is redirected to People", async (_n, roles, scoped) => {
    as(roles, scoped);
    await expect(AccessIndexPage()).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/settings/access/people",
    );
  });

  it("a viewer without a scope gets the not-found page", async () => {
    as(["internal-viewer"]);
    await expect(AccessIndexPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a session that builds no viewer gets the not-found page", async () => {
    auth.mockResolvedValue(null);
    loadViewer.mockResolvedValue(undefined);
    await expect(AccessIndexPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
