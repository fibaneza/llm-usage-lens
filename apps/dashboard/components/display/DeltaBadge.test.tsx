import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeltaBadge } from "./DeltaBadge";

// Design System -- Component Inventory, `DeltaBadge`: "+12.3%" green arrow or
// "-5.1%" red arrow for trends. The spec text is followed literally: a
// positive delta gets a green (success token) arrow, a negative delta a red
// (destructive token) arrow; the percentage text itself stays on an
// accessible text token (4.5:1). The sign is always shown, with one decimal. With no
// usable previous period nothing is rendered -- never a fake 0% (Rule 20).
describe("DeltaBadge", () => {
  it("shows a positive delta with a plus sign and one decimal", () => {
    render(<DeltaBadge current={112.3} previous={100} />);

    expect(screen.getByText("+12.3%")).toBeInTheDocument();
  });

  it("shows a negative delta with a minus sign and one decimal", () => {
    render(<DeltaBadge current={94.9} previous={100} />);

    expect(screen.getByText(/^[-−]5\.1%$/)).toBeInTheDocument();
  });

  it("rounds to one decimal place", () => {
    render(<DeltaBadge current={100} previous={300} />);

    expect(screen.getByText(/^[-−]66\.7%$/)).toBeInTheDocument();
  });

  it("shows a delta beyond 100% without capping it", () => {
    render(<DeltaBadge current={250} previous={100} />);

    expect(screen.getByText("+150.0%")).toBeInTheDocument();
  });

  it("shows a full drop as -100.0%", () => {
    render(<DeltaBadge current={0} previous={50} />);

    expect(screen.getByText(/^[-−]100\.0%$/)).toBeInTheDocument();
  });

  it("shows no change as 0.0%", () => {
    render(<DeltaBadge current={40} previous={40} />);

    expect(screen.getByText(/^[+\-−]?0\.0%$/)).toBeInTheDocument();
  });

  it("colours the arrow with the success token for an increase", () => {
    const { container } = render(<DeltaBadge current={112.3} previous={100} />);

    const arrow = container.querySelector("svg");
    expect(arrow?.getAttribute("class")).toMatch(/(text|stroke)-success/);
    expect(arrow?.getAttribute("class")).not.toMatch(/destructive/);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("colours the arrow with the destructive token for a decrease", () => {
    const { container } = render(<DeltaBadge current={94.9} previous={100} />);

    const arrow = container.querySelector("svg");
    expect(arrow?.getAttribute("class")).toMatch(/(text|stroke)-destructive/);
    expect(arrow?.getAttribute("class")).not.toMatch(/success/);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  // Design System -- UX Standards: text contrast 4.5:1. `--color-success`
  // measures 3.77:1 on the card, so the coloured arrow (non-text, 3:1 -- WCAG
  // 1.4.11) carries the green/red and the percentage text uses a text token.
  it.each([
    ["an increase", 112.3, 100, "+12.3%"],
    ["a decrease", 94.9, 100, /^[-\u2212]5\.1%$/],
  ] as const)(
    "keeps the success and destructive tokens off the percentage text for %s",
    (_label, current, previous, text) => {
      render(<DeltaBadge current={current} previous={previous} />);

      const percentage = screen.getByText(text);
      const root = screen.getByRole("img");
      const chain: HTMLElement[] = [];
      for (
        let el: HTMLElement | null = percentage;
        el !== null;
        el = el === root ? null : el.parentElement
      ) {
        chain.push(el);
      }
      const classes = chain.map((el) => el.getAttribute("class") ?? "");

      for (const cls of classes) {
        expect(cls).not.toMatch(
          /(^|\s)text-(success|destructive)(\/\d+)?(\s|$)/,
        );
      }
      expect(
        classes.some((cls) =>
          /(^|\s)text-(foreground|muted-foreground)(\s|$)/.test(cls),
        ),
      ).toBe(true);
    },
  );

  it("names the direction and magnitude for assistive technology", () => {
    render(<DeltaBadge current={112.3} previous={100} />);

    expect(
      screen.getByRole("img", { name: "Up 12.3% vs previous period" }),
    ).toBeInTheDocument();
  });

  it("draws a decorative Lucide arrow that screen readers skip", () => {
    const { container } = render(<DeltaBadge current={112.3} previous={100} />);

    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("renders nothing when there is no previous period", () => {
    const { container } = render(<DeltaBadge current={42} previous={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the previous period is zero, never Infinity or NaN", () => {
    const { container } = render(<DeltaBadge current={42} previous={0} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when both periods are zero", () => {
    const { container } = render(<DeltaBadge current={0} previous={0} />);

    expect(container).toBeEmptyDOMElement();
  });
});
