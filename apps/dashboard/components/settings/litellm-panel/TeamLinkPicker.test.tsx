import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TeamLinkPicker, type TeamLinkOption } from "./TeamLinkPicker";

// Source: Design System - Management improvements, D4a (2026-11-17; item 15):
// both ids are chosen from a searchable combobox (keyboard and screen-reader
// operable), a team that already has a link shows "linked" and cannot be
// chosen (one-to-one), and an id is never typed. LiteLLM spec MI-D4a, LT-MI3
// (the picker is a convenience, never the control). Module under test:
//   <TeamLinkPicker label options value onChange placeholder />
// with options { id, primary, secondary, linked }.
const OPTIONS: TeamLinkOption[] = [
  { id: "alpha-id", primary: "Alpha", secondary: "alpha-id", linked: false },
  { id: "beta-id", primary: "Beta", secondary: "beta-id", linked: true },
  { id: "gamma-id", primary: "Gamma", secondary: "gamma-id", linked: false },
];

function setup(value = "") {
  const onChange = vi.fn();
  render(
    <TeamLinkPicker
      label="Team"
      placeholder="Choose a team"
      options={OPTIONS}
      value={value}
      onChange={onChange}
    />,
  );
  return { onChange, trigger: screen.getByRole("combobox", { name: "Team" }) };
}

describe("TeamLinkPicker (D4a)", () => {
  it("is a labelled combobox that shows the placeholder, or the chosen name", () => {
    const { trigger } = setup();
    expect(trigger).toHaveTextContent("Choose a team");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the chosen option by name, not by id", () => {
    const { trigger } = setup("gamma-id");
    expect(trigger).toHaveTextContent("Gamma");
    expect(trigger).not.toHaveTextContent("gamma-id");
  });

  it("lists every option by name with its id as secondary text, and marks the linked one", async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    for (const o of OPTIONS) {
      const option = screen.getByRole("option", {
        name: new RegExp(o.primary),
      });
      expect(within(option).getByText(o.primary)).toBeInTheDocument();
      expect(within(option).getByText(o.secondary)).toBeInTheDocument();
    }
    const beta = screen.getByRole("option", { name: /Beta/ });
    expect(beta).toHaveTextContent("linked");
    expect(beta).toHaveAttribute("aria-disabled", "true");
    const alpha = screen.getByRole("option", { name: /Alpha/ });
    expect(alpha).not.toHaveTextContent("linked");
    expect(alpha).not.toHaveAttribute("aria-disabled", "true");
  });

  it("typing filters the list by name and by id; no match says so", async () => {
    const { trigger } = setup();
    await userEvent.click(trigger);
    const search = screen.getByLabelText("Search Team");
    await userEvent.type(search, "gam");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Gamma");
    await userEvent.clear(search);
    await userEvent.type(search, "alpha-id");
    expect(screen.getByRole("option")).toHaveTextContent("Alpha");
    await userEvent.clear(search);
    await userEvent.type(search, "zzzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/no match/i)).toBeInTheDocument();
  });

  it("clicking an option chooses its id and closes the list; clicking a linked option chooses nothing", async () => {
    const { trigger, onChange } = setup();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("option", { name: /Beta/ }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("option", { name: /Gamma/ }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("gamma-id");
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("offers no input that takes an id: the only text field is the search box", async () => {
    const { trigger } = setup();
    expect(document.querySelectorAll("input")).toHaveLength(0);
    await userEvent.click(trigger);
    const inputs = [...document.querySelectorAll("input")];
    expect(inputs.map((i) => i.getAttribute("aria-label"))).toEqual([
      "Search Team",
    ]);
  });

  it("keyboard: Enter opens, Arrow moves past the linked option, Enter chooses", async () => {
    const { trigger, onChange } = setup();
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("gamma-id");
  });

  it("keyboard: Escape closes the list and returns focus to the combobox, choosing nothing", async () => {
    const { trigger, onChange } = setup();
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("option")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });
});
