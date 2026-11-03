import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CountFigure,
  FigureFormatProvider,
  UsdFigure,
  type FigureFormat,
} from "./figures";

// Design System -- UX Standards ("abbreviated large numbers, $12.5K"): the
// compact format abbreviates figures at or above 1,000 and keeps the full value
// in `title`; the default "full" format shows every digit and no title.
function renderFigures(format: FigureFormat | null, ui: React.ReactElement) {
  return render(
    format === null ? (
      ui
    ) : (
      <FigureFormatProvider value={format}>{ui}</FigureFormatProvider>
    ),
  );
}

describe("UsdFigure", () => {
  it("abbreviates a large amount in compact format and keeps the full value as the title", () => {
    renderFigures("compact", <UsdFigure value={123_456.78} />);

    const figure = screen.getByText("$123.5K");
    expect(figure).toHaveAttribute("title", "$123,456.78");
  });

  it("keeps cents and adds no title below $1,000 in compact format", () => {
    renderFigures("compact", <UsdFigure value={999.5} />);

    const figure = screen.getByText("$999.50");
    expect(figure).not.toHaveAttribute("title");
  });

  it("shows the full amount and no title in full format", () => {
    renderFigures("full", <UsdFigure value={123_456.78} />);

    const figure = screen.getByText("$123,456.78");
    expect(figure).not.toHaveAttribute("title");
  });

  it("defaults to full format without a provider", () => {
    renderFigures(null, <UsdFigure value={123_456.78} />);

    const figure = screen.getByText("$123,456.78");
    expect(figure).not.toHaveAttribute("title");
  });

  it("applies the className to the figure", () => {
    renderFigures("compact", <UsdFigure value={5} className="font-mono" />);

    expect(screen.getByText("$5.00")).toHaveClass("font-mono");
  });
});

describe("CountFigure", () => {
  it("abbreviates a large count in compact format and keeps the full value as the title", () => {
    renderFigures("compact", <CountFigure value={98_765_432} />);

    const figure = screen.getByText("98.8M");
    expect(figure).toHaveAttribute("title", "98,765,432");
  });

  it("adds no title when a compact count is already short", () => {
    renderFigures("compact", <CountFigure value={999} />);

    const figure = screen.getByText("999");
    expect(figure).not.toHaveAttribute("title");
  });

  it("shows the full count and no title in full format", () => {
    renderFigures("full", <CountFigure value={98_765_432} />);

    const figure = screen.getByText("98,765,432");
    expect(figure).not.toHaveAttribute("title");
  });

  it("defaults to full format without a provider", () => {
    renderFigures(null, <CountFigure value={98_765_432} />);

    const figure = screen.getByText("98,765,432");
    expect(figure).not.toHaveAttribute("title");
  });
});
