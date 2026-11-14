import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { SettingsContent } from "./SettingsContent";

// Source: docs/specs/2026-11-10-litellm.md -- "Page and Settings" (Admin
// LiteLLM panel in Settings, its own section); implementation-phases L1 (the
// panel is an `internal-admin` section in the existing shell); Rule 40.4.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
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
      if (url.includes("/api/sync-status")) {
        return Promise.resolve(
          apiResponse({ data: { state: "never-synced" } }),
        );
      }
      return Promise.resolve(apiResponse({ data: [] }));
    }),
  );
}

describe("SettingsContent LiteLLM section", () => {
  it("renders a LiteLLM section with the panel for an Admin", async () => {
    stubFetch();
    renderWithProviders(<SettingsContent isAdmin />);
    expect(
      await screen.findByRole("heading", { name: "LiteLLM" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("https://litellm.example.internal"),
    ).toBeInTheDocument();
  });

  it("omits the section, and never requests the connection, for a non-admin", async () => {
    stubFetch();
    renderWithProviders(<SettingsContent isAdmin={false} />);
    await screen.findByRole("heading", { name: /account registry/i });
    expect(screen.queryByRole("heading", { name: "LiteLLM" })).toBeNull();
    const fetchMock = vi.mocked(fetch);
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("/api/litellm")),
    ).toBe(false);
  });
});
