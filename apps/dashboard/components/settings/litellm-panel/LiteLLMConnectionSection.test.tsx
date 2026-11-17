import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMConnectionSection } from "./LiteLLMConnectionSection";

// Source: LiteLLM spec LD24 (Connection edit: Admin only; org-admin and Auditor
// read it) and "Security architecture" item 6 (URL, edition, key status; no key
// input); Design System "Settings Page" - LiteLLM sub-tabs (unit A2: one
// section per route). Module under test:
// `components/settings/litellm-panel/LiteLLMConnectionSection.tsx`
//   <LiteLLMConnectionSection canEdit={boolean} />
// The write payloads and error states are covered by the legacy panel suite
// (components/settings/LiteLLMPanel*.test.tsx); this file proves the split.
afterEach(() => {
  vi.unstubAllGlobals();
});

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        apiResponse({
          data: {
            baseUrl: "https://litellm.example.internal",
            version: 1,
            edition: "oss",
            serviceKeyConfigured: true,
          },
        }),
      ),
    ),
  );
}

describe("LiteLLMConnectionSection", () => {
  it("an editor sees the status, the Base URL form and Test connection", async () => {
    stub();
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
    expect(
      await screen.findByText("https://litellm.example.internal"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/base url/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /test connection/i }),
    ).toBeInTheDocument();
  });

  it("a read-only caller sees the status and no write control", async () => {
    stub();
    renderWithProviders(<LiteLLMConnectionSection canEdit={false} />);
    expect(
      await screen.findByText("https://litellm.example.internal"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/base url/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^save/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /test connection/i }),
    ).toBeNull();
  });

  it("does not render the other sections' content or tabs", async () => {
    stub();
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
    await screen.findByText("https://litellm.example.internal");
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
