import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { lazy } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SectionBoundary } from "./SectionBoundary";

// Rule 40.4 / 60.12: every page section sits in its own Suspense +
// ErrorBoundary with a Skeleton fallback, so one slow or failing section never
// blocks or breaks the page (Design System -- Component Inventory,
// `ErrorBoundary`: "one chart failing doesn't crash the page").

function Ok({ text }: { text: string }) {
  return <p>{text}</p>;
}

function Boom(): never {
  throw new Error("boom");
}

const NeverLoads = lazy(() => new Promise<{ default: () => null }>(() => {}));

beforeEach(() => {
  // React logs every caught render error; keep the test output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SectionBoundary", () => {
  it("renders its children when nothing is pending or failing", () => {
    render(
      <SectionBoundary title="Cost trend">
        <Ok text="trend content" />
      </SectionBoundary>,
    );

    expect(screen.getByText("trend content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the default Skeleton while a child is suspended", () => {
    const { container } = render(
      <SectionBoundary title="Cost trend">
        <NeverLoads />
      </SectionBoundary>,
    );

    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  it("shows a custom fallback while a child is suspended", () => {
    render(
      <SectionBoundary title="Cost trend" fallback={<p>Loading cost trend</p>}>
        <NeverLoads />
      </SectionBoundary>,
    );

    expect(screen.getByText("Loading cost trend")).toBeInTheDocument();
  });

  it("swaps the fallback for the content once the child resolves", async () => {
    const Resolves = lazy(() =>
      Promise.resolve({ default: () => <Ok text="resolved content" /> }),
    );

    render(
      <SectionBoundary title="Cost trend" fallback={<p>Loading cost trend</p>}>
        <Resolves />
      </SectionBoundary>,
    );

    expect(await screen.findByText("resolved content")).toBeInTheDocument();
    expect(screen.queryByText("Loading cost trend")).not.toBeInTheDocument();
  });

  it("renders a role=alert naming the failed section when a child throws", () => {
    render(
      <SectionBoundary title="Cost trend">
        <Boom />
      </SectionBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load Cost trend.",
    );
  });

  it("offers a Retry button in the error state", () => {
    render(
      <SectionBoundary title="Cost trend">
        <Boom />
      </SectionBoundary>,
    );

    expect(
      within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
  });

  it("re-renders the children when Retry is pressed and the cause is gone", async () => {
    const user = userEvent.setup();
    let failing = true;
    function Flaky() {
      if (failing) throw new Error("transient");
      return <Ok text="recovered content" />;
    }

    render(
      <SectionBoundary title="Cost trend">
        <Flaky />
      </SectionBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    failing = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByText("recovered content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays in the error state when Retry is pressed and the child still throws", async () => {
    const user = userEvent.setup();

    render(
      <SectionBoundary title="Cost trend">
        <Boom />
      </SectionBoundary>,
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load Cost trend.",
    );
  });

  it("isolates a failing section from its siblings", () => {
    render(
      <>
        <SectionBoundary title="Cost trend">
          <Boom />
        </SectionBoundary>
        <SectionBoundary title="Model distribution">
          <Ok text="donut content" />
        </SectionBoundary>
      </>,
    );

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Cost trend");
    expect(screen.getByText("donut content")).toBeInTheDocument();
  });

  it("isolates a suspended section from its siblings", () => {
    render(
      <>
        <SectionBoundary
          title="Cost trend"
          fallback={<p>Loading cost trend</p>}
        >
          <NeverLoads />
        </SectionBoundary>
        <SectionBoundary title="Model distribution">
          <Ok text="donut content" />
        </SectionBoundary>
      </>,
    );

    expect(screen.getByText("Loading cost trend")).toBeInTheDocument();
    expect(screen.getByText("donut content")).toBeInTheDocument();
  });
});
