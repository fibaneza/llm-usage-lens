import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Design System "Settings Page" - LiteLLM sub-tabs (unit A2,
// 2026-11-17, D-A2-2): `/dashboard/settings/litellm` redirects on the server to
// the caller's first visible sub-tab (Connection for all three LiteLLM roles);
// a caller without the LiteLLM tab (litellmPanelCapabilities().visible false;
// LD24) gets the same 404 as a missing page. Rule 10.3 / 60.10 (authorized per
// request in the page). Module under test:
// `app/dashboard/settings/litellm/page.tsx` (redirect only; the panel moved to
// `[section]/page.tsx`).
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
const loadViewer = vi.fn();
vi.mock("@/lib/auth/settings-access", () => ({
  loadSettingsAccessViewer: (session: unknown) => loadViewer(session),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});

import {
  resetManageAccess,
  setManageAccess,
} from "@/test/fakes/manage-access-fake";

import LiteLLMSettingsIndexPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
  resetManageAccess();
});

function as(roles: string[], scoped = false) {
  auth.mockResolvedValue({ user: { oid: "oid-1", roles } });
  loadViewer.mockResolvedValue({
    roles,
    authMethod: "entra",
    adminScopes: scoped ? [{ scopeType: "team", scopeId: "team-pay" }] : [],
  });
}

describe("LiteLLM settings index", () => {
  it.each([["internal-admin"], ["internal-org-admin"], ["internal-auditor"]])(
    "%s is redirected to Connection",
    async (role) => {
      as([role]);
      await expect(LiteLLMSettingsIndexPage()).rejects.toThrow(
        "NEXT_REDIRECT:/dashboard/settings/litellm/connection",
      );
    },
  );

  it.each([
    ["a viewer without a scope", ["internal-viewer"], false],
    ["a team-scope admin", ["internal-viewer"], true],
    ["legacy Admin", ["Admin"], false],
    ["no roles", [], false],
  ])("%s gets the not-found page", async (_n, roles, scoped) => {
    as(roles, scoped);
    await expect(LiteLLMSettingsIndexPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a session that builds no viewer gets the not-found page", async () => {
    auth.mockResolvedValue(null);
    loadViewer.mockResolvedValue(undefined);
    await expect(LiteLLMSettingsIndexPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a closed Settings (management gate) wins over the role", async () => {
    setManageAccess({ settings: false });
    as(["internal-admin"]);
    await expect(LiteLLMSettingsIndexPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
