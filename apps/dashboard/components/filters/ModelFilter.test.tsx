import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MODEL_KEYS, MODEL_META, type ModelKey } from "@llm-usage-lens/shared";
import { describe, expect, it, vi } from "vitest";

import { ModelFilter } from "./ModelFilter";

// Design System -- Component Inventory, `ModelFilter`: "Dropdown to filter by
// specific Bedrock model" (shadcn Select). Options are "All models" followed by
// every canonical model key's display name from packages/shared (Rule 20.5);
// onChange receives the model key, or "all".
const EXPECTED_OPTIONS = [
  "All models",
  ...MODEL_KEYS.map((key) => MODEL_META[key].displayName),
];

function renderFilter(value: ModelKey | "all") {
  const onChange = vi.fn<(value: ModelKey | "all") => void>();
  render(<ModelFilter value={value} onChange={onChange} />);
  return onChange;
}

const trigger = () => screen.getByRole("combobox", { name: "Model" });

describe("ModelFilter", () => {
  it("shows All models as the current selection by default", () => {
    renderFilter("all");

    expect(within(trigger()).getByText("All models")).toBeInTheDocument();
  });

  it("shows the display name of the selected model", () => {
    renderFilter("claude-sonnet");

    expect(
      within(trigger()).getByText(MODEL_META["claude-sonnet"].displayName),
    ).toBeInTheDocument();
  });

  it("offers All models followed by every model display name", async () => {
    const user = userEvent.setup();
    renderFilter("all");

    await user.click(trigger());

    const options = await screen.findAllByRole("option");
    expect(options.map((el) => el.textContent?.trim())).toEqual(
      EXPECTED_OPTIONS,
    );
  });

  it("passes the model key to onChange when a model is picked", async () => {
    const user = userEvent.setup();
    const onChange = renderFilter("all");

    await user.click(trigger());
    await user.click(
      await screen.findByRole("option", {
        name: MODEL_META["claude-opus"].displayName,
      }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("claude-opus");
  });

  it("passes 'all' to onChange when All models is picked", async () => {
    const user = userEvent.setup();
    const onChange = renderFilter("claude-haiku");

    await user.click(trigger());
    await user.click(await screen.findByRole("option", { name: "All models" }));

    expect(onChange).toHaveBeenCalledWith("all");
  });
});
