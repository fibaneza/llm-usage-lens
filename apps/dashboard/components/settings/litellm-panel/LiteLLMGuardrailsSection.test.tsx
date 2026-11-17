import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMGuardrailsSection } from "./LiteLLMGuardrailsSection";

// Source: LiteLLM spec LD24 (Guardrails edit: Admin and org-admin; Auditor
// read-only) and LD19 (toggles, source, "enforced in code" summary); Design
// System "Settings Page" - LiteLLM sub-tabs (unit A2: one section per route).
// Module under test: `components/settings/litellm-panel/LiteLLMGuardrailsSection.tsx`
//   <LiteLLMGuardrailsSection canEdit={boolean} />
// = the toggles plus the "Enforced in code" summary. Payload, grouping, reset
// and conflict behaviour stay covered by LiteLLMPanel.guardrails.test.tsx.
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
            version: 2,
            edition: "oss",
            operations: { createTeam: { enabled: true, source: "spec" } },
          },
        }),
      ),
    ),
  );
}

describe("LiteLLMGuardrailsSection", () => {
  it("an editor gets switches and Reset to defaults, plus the enforced-in-code summary", async () => {
    stub();
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    expect(
      await screen.findByRole("switch", { name: "createTeam" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reset to defaults/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /enforced in code/i }),
    ).toBeInTheDocument();
  });

  it("a read-only caller sees the values and the summary, no switch and no reset", async () => {
    stub();
    renderWithProviders(<LiteLLMGuardrailsSection canEdit={false} />);
    expect(
      await screen.findByTestId("litellm-op-createTeam"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /reset to defaults/i }),
    ).toBeNull();
    expect(
      screen.getByRole("region", { name: /enforced in code/i }),
    ).toBeInTheDocument();
  });
});
