import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Design System "Settings Page" (unit D, 2026-11-16: the LiteLLM tab is
// visible to internal-admin, internal-org-admin and internal-auditor; any other
// caller gets the same 404 as a missing page); LiteLLM spec LD24; Rule 10.3 /
// 60.10 (authorization read per request, in the page itself - a layout is not
// re-run on soft navigation). Module under test:
// `app/dashboard/settings/litellm/page.tsx`: resolves the viewer, calls
// `notFound()` unless `litellmPanelCapabilities(viewer.roles).visible`, else
// renders `<LiteLLMTab capabilities={litellmPanelCapabilities(viewer.roles)} />`
// (unit D rework after unit A1, cec7e44; LD24: admin edits all, org-admin edits
// Guardrails and Team links, auditor read-only).
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
vi.mock("@/components/settings/LiteLLMTab", () => ({
  LiteLLMTab: (props: { capabilities: unknown }) => (
    <div data-testid="tab">{JSON.stringify(props.capabilities)}</div>
  ),
}));

import { litellmPanelCapabilities } from "@/lib/auth/litellm-panel";

// Slice B2 B2-10: the gate matrix lives in the manage-routes integration test.
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});

import LiteLLMSettingsPage from "./page";

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

describe("LiteLLM settings page", () => {
  it.each([["internal-admin"], ["internal-org-admin"], ["internal-auditor"]])(
    "passes the %s capabilities to the tab",
    async (role) => {
      as([role]);
      render(await LiteLLMSettingsPage());
      expect(JSON.parse(screen.getByTestId("tab").textContent ?? "")).toEqual(
        litellmPanelCapabilities([role]),
      );
    },
  );

  it("an org-admin cannot edit the connection but edits guardrails and team links", async () => {
    as(["internal-org-admin"]);
    render(await LiteLLMSettingsPage());
    expect(
      JSON.parse(screen.getByTestId("tab").textContent ?? ""),
    ).toMatchObject({
      editConnection: false,
      editGuardrails: true,
      editTeamLinks: true,
    });
  });

  it.each([
    ["a viewer without a scope", ["internal-viewer"], false],
    ["a team-scope admin", ["internal-viewer"], true],
  ])("%s gets the not-found page", async (_n, roles, scoped) => {
    as(roles, scoped);
    await expect(LiteLLMSettingsPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a session that builds no viewer gets the not-found page", async () => {
    auth.mockResolvedValue(null);
    loadViewer.mockResolvedValue(undefined);
    await expect(LiteLLMSettingsPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
