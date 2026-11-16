import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

// Source: Design System - Component Inventory (Tabs: the vendored shadcn/Radix
// Tabs behind the LiteLLM page and the Settings panel), WCAG 2.1.1 keyboard
// and 2.4.7 focus visible (Rule 60.30); L3b review B2, B3. Radix gives the
// WAI-ARIA tabs pattern: roving tabindex, arrows move between triggers, Home
// and End jump, Tab leaves the tablist into the active panel.
function renderTabs() {
  return render(
    <Tabs defaultValue="one">
      <TabsList aria-label="Sections">
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
        <TabsTrigger value="three">Three</TabsTrigger>
      </TabsList>
      <TabsContent value="one">
        <button type="button">Inside one</button>
      </TabsContent>
      <TabsContent value="two">Panel two</TabsContent>
      <TabsContent value="three">Panel three</TabsContent>
    </Tabs>,
  );
}
const tab = (name: string) => screen.getByRole("tab", { name });

describe("Tabs keyboard navigation", () => {
  it("ArrowRight and ArrowLeft move focus and selection between triggers, wrapping at the ends", async () => {
    const user = userEvent.setup();
    renderTabs();
    tab("One").focus();
    await user.keyboard("{ArrowRight}");
    expect(tab("Two")).toHaveFocus();
    expect(tab("Two")).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(tab("Three")).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel three");
  });

  it("Home jumps to the first trigger and End to the last", async () => {
    const user = userEvent.setup();
    renderTabs();
    tab("One").focus();
    await user.keyboard("{End}");
    expect(tab("Three")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(tab("One")).toHaveFocus();
    expect(tab("One")).toHaveAttribute("aria-selected", "true");
  });

  it("Tab moves focus from the active trigger into the panel, then on to its content", async () => {
    const user = userEvent.setup();
    renderTabs();
    tab("One").focus();
    await user.tab();
    expect(screen.getByRole("tabpanel")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Inside one" })).toHaveFocus();
  });

  it("a panel with no focusable content is itself focusable and shows a focus ring (WCAG 2.4.7; review B2)", async () => {
    const user = userEvent.setup();
    renderTabs();
    await user.click(tab("Two"));
    await user.tab();
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveFocus();
    expect(panel.className).toMatch(/focus-visible:ring/);
  });
});
