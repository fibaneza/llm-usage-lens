import { MODEL_KEYS, MODEL_META } from "@llm-usage-lens/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModelBadge } from "./ModelBadge";

// Source: Design System -- Component Inventory (`ModelBadge`: model name with
// its assigned color dot); Rule 20.5 (names/tokens come from
// `packages/shared/src/models.ts`), Rule 40.2 (token, no raw hex).
// Contract: `<ModelBadge model="claude-opus" />` shows the display name; the
// dot is a decorative element whose inline background is `var(<chartToken>)`.
describe("ModelBadge", () => {
  it.each(MODEL_KEYS)("shows the display name of %s", (model) => {
    render(<ModelBadge model={model} />);

    expect(screen.getByText(MODEL_META[model].displayName)).toBeInTheDocument();
  });

  it.each(MODEL_KEYS)("colors the dot with the %s CSS token", (model) => {
    const { container } = render(<ModelBadge model={model} />);

    const dot = container.querySelector(
      `[style*="var(${MODEL_META[model].chartToken})"]`,
    );
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-hidden", "true");
  });

  it("uses no raw hex color", () => {
    const { container } = render(<ModelBadge model="claude-sonnet" />);

    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
