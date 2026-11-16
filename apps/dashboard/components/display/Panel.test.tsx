import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { lazy } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Panel } from "./Panel";

// Design System -- Component Inventory, `Panel` (2026-11-16): titled section
// with `h2`, description, actions, its own Suspense + SectionBoundary +
// skeleton, flush table mode; Rule 40 item 9 / 60.12 (own Suspense and
// ErrorBoundary per section); design-plan section 4.7 (busy = aria-busy).
function Boom(): never {
  throw new Error("boom");
}

const NeverLoads = lazy(() => new Promise<{ default: () => null }>(() => {}));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Panel", () => {
  it("is a card-surface region named by its h2 title, carrying the id", () => {
    const { container } = render(
      <Panel id="account-registry" title="Account registry" boundaryTitle="x">
        <p>body</p>
      </Panel>,
    );

    const region = screen.getByRole("region", { name: "Account registry" });
    expect(region).toHaveAttribute("id", "account-registry");
    expect(region).toHaveAttribute("data-slot", "card");
    expect(
      screen.getByRole("heading", { level: 2, name: "Account registry" }),
    ).toHaveAttribute("data-slot", "card-title");
    expect(container.querySelectorAll("h2")).toHaveLength(1);
  });

  it("renders an h3 title when headingLevel is 3", () => {
    render(
      <Panel title="Keys" headingLevel={3} boundaryTitle="Keys">
        <p>body</p>
      </Panel>,
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Keys" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("renders the description, badge, actions and children", () => {
    render(
      <Panel
        title="Teams breakdown"
        description="Cost per team."
        badge={<span>LiteLLM-reported</span>}
        actions={<button type="button">Add account</button>}
        boundaryTitle="Teams breakdown"
      >
        <p>panel body</p>
      </Panel>,
    );

    const region = screen.getByRole("region", { name: "Teams breakdown" });
    expect(within(region).getByText("Cost per team.")).toBeInTheDocument();
    expect(within(region).getByText("LiteLLM-reported")).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: "Add account" }),
    ).toBeInTheDocument();
    expect(within(region).getByText("panel body")).toBeInTheDocument();
  });

  it("pads the body by default and renders it flush when asked", () => {
    const { rerender } = render(
      <Panel title="Rows" boundaryTitle="Rows">
        <p>body</p>
      </Panel>,
    );
    const body = () =>
      screen.getByText("body").closest('[data-slot="card-content"]');
    expect(body()).toHaveClass("px-4");

    rerender(
      <Panel title="Rows" boundaryTitle="Rows" flush>
        <p>body</p>
      </Panel>,
    );
    expect(body()).not.toHaveClass("px-4");
  });

  it("isolates a failing child behind its own alert and Retry, leaving the title", () => {
    render(
      <Panel title="Cost trend" boundaryTitle="Cost trend">
        <Boom />
      </Panel>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load Cost trend.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Cost trend" }),
    ).toBeInTheDocument();
  });

  it("runs onReset after Retry is clicked", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(
      <Panel title="Cost trend" boundaryTitle="Cost trend" onReset={onReset}>
        <Boom />
      </Panel>,
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("shows the supplied skeleton while a child suspends", () => {
    render(
      <Panel
        title="Cost trend"
        boundaryTitle="Cost trend"
        skeleton={<div data-testid="panel-skeleton" />}
      >
        <NeverLoads />
      </Panel>,
    );

    expect(screen.getByTestId("panel-skeleton")).toBeInTheDocument();
  });

  it("marks the region aria-busy only while busy", () => {
    const { rerender } = render(
      <Panel title="Cost trend" boundaryTitle="Cost trend" busy>
        <p>body</p>
      </Panel>,
    );
    expect(screen.getByRole("region", { name: "Cost trend" })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    rerender(
      <Panel title="Cost trend" boundaryTitle="Cost trend">
        <p>body</p>
      </Panel>,
    );
    expect(
      screen.getByRole("region", { name: "Cost trend" }),
    ).not.toHaveAttribute("aria-busy", "true");
  });
});
