import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { litellmPanelCapabilities } from "@/lib/auth/litellm-panel";
import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMTab } from "./LiteLLMTab";

// Source: docs/specs/2026-11-10-litellm.md -- "Page and Settings" (the
// LiteLLM panel in Settings, its own section; tabbed from L3b); Design System
// "Settings Page" (unit D, 2026-11-16: the panel moves unchanged under the
// LiteLLM tab; who sees the tab is decided by lib/settings-tabs); Rule 40.4.
// Module under test: `components/settings/LiteLLMTab.tsx`
//   <LiteLLMTab capabilities={LiteLLMPanelCapabilities} /> - the `LiteLLMPanel`
//   under an h2 "LiteLLM"; the capabilities are `litellmPanelCapabilities(roles)`
//   from `lib/auth/litellm-panel.ts` (unit D rework after unit A1, cec7e44).
// Moved from SettingsContent.litellm.test.tsx. The old "omitted, and never
// requests the connection, for a non-admin" case is now route-level: the tab is
// absent from settingsTabsFor() (lib/settings-tabs.test.ts) and its URL is a
// 404 that issues no /api/litellm request (e2e/settings-tabs.spec.ts).
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ADMIN = litellmPanelCapabilities(["internal-admin"]);
const ORG_ADMIN = litellmPanelCapabilities(["internal-org-admin"]);
const AUDITOR = litellmPanelCapabilities(["internal-auditor"]);

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/litellm/toggles")) {
        return Promise.resolve(
          apiResponse({
            data: {
              version: 0,
              edition: "oss",
              operations: { createTeam: { enabled: true, source: "file" } },
            },
          }),
        );
      }
      if (url.includes("/api/litellm/connection")) {
        return Promise.resolve(
          apiResponse({
            data: {
              baseUrl: "https://litellm.example.internal",
              version: 1,
              edition: "oss",
              serviceKeyConfigured: true,
            },
          }),
        );
      }
      return Promise.resolve(apiResponse({ data: [] }));
    }),
  );
}

describe("LiteLLMTab", () => {
  it("renders the LiteLLM section with the panel for an admin", async () => {
    stubFetch();
    renderWithProviders(<LiteLLMTab capabilities={ADMIN} />);
    expect(
      await screen.findByRole("heading", { level: 2, name: "LiteLLM" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("https://litellm.example.internal"),
    ).toBeInTheDocument();
    // L2 (LD19): the operation toggles live in the same section; since L3b
    // they sit on the Guardrails tab.
    await userEvent.click(screen.getByRole("tab", { name: "Guardrails" }));
    expect(
      await screen.findByRole("switch", { name: "createTeam" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reset to file defaults/i }),
    ).toBeInTheDocument();
  });

  // Carried from A1 e2e "an Auditor sees Settings -> LiteLLM read-only"
  // (LD24, LT22): connection read-only, no switch, no reset.
  it("an auditor's capabilities give a read-only panel", async () => {
    stubFetch();
    renderWithProviders(<LiteLLMTab capabilities={AUDITOR} />);
    await screen.findByText("https://litellm.example.internal");
    expect(
      screen.queryByRole("button", { name: /^save/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /test connection/i }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Guardrails" }));
    await screen.findByTestId("litellm-op-createTeam");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reset to file defaults/i }),
    ).not.toBeInTheDocument();
  });

  // Carried from A1 e2e "an org-admin cannot edit Connection but edits
  // Guardrails and Team links" (LD24).
  it("an org-admin's capabilities: Connection read-only, Guardrails editable", async () => {
    stubFetch();
    renderWithProviders(<LiteLLMTab capabilities={ORG_ADMIN} />);
    await screen.findByText("https://litellm.example.internal");
    expect(screen.queryByLabelText(/base url/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /test connection/i }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Guardrails" }));
    expect(
      await screen.findByRole("switch", { name: "createTeam" }),
    ).toBeInTheDocument();
  });
});
