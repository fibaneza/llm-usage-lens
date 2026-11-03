import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SparklineCell } from "./SparklineCell";

// Design System -- Component Inventory, `SparklineCell`: "Inline trend sparkline
// for table cells". A small inline SVG polyline -- no Recharts, which is too
// heavy for a table cell -- exposed as an image with an aria-label. Fewer than
// two points cannot draw a line, so the cell shows "—". The stroke is a token
// (Rule 40.2).
function parsePoints(polyline: Element): Array<[number, number]> {
  const numbers = (polyline.getAttribute("points") ?? "").match(
    /-?\d+(?:\.\d+)?(?:e-?\d+)?/gi,
  );
  const values = (numbers ?? []).map(Number);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    pairs.push([values[i] as number, values[i + 1] as number]);
  }
  return pairs;
}

describe("SparklineCell", () => {
  it("draws a labelled image containing one polyline vertex per point", () => {
    const { container } = render(
      <SparklineCell points={[1, 3, 2, 5, 4]} label="Cost trend" />,
    );

    expect(screen.getByRole("img", { name: "Cost trend" })).toBeInTheDocument();
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    expect(parsePoints(polyline as Element)).toHaveLength(5);
  });

  it("does not use Recharts", () => {
    const { container } = render(
      <SparklineCell points={[1, 2, 3]} label="Cost trend" />,
    );

    expect(container.querySelector(".recharts-wrapper")).toBeNull();
  });

  it("runs left to right and draws a rising series upward", () => {
    const { container } = render(
      <SparklineCell points={[1, 2, 3, 4, 5]} label="Cost trend" />,
    );

    const pairs = parsePoints(container.querySelector("polyline") as Element);
    const xs = pairs.map(([x]) => x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(xs.length);
    // SVG y grows downward, so a higher value has a smaller y.
    const first = pairs[0] as [number, number];
    const last = pairs[pairs.length - 1] as [number, number];
    expect(first[1]).toBeGreaterThan(last[1]);
  });

  it("draws a flat series without NaN or Infinity coordinates", () => {
    const { container } = render(
      <SparklineCell points={[5, 5, 5]} label="Cost trend" />,
    );

    const attr = container.querySelector("polyline")?.getAttribute("points");
    expect(attr).toBeTruthy();
    expect(attr).not.toMatch(/NaN|Infinity/);
  });

  it("strokes with a token, never a raw colour", () => {
    const { container } = render(
      <SparklineCell points={[1, 2, 3]} label="Cost trend" />,
    );

    expect(container.innerHTML).toMatch(/var\(--|stroke-|currentColor/);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });

  it.each([[[]], [[7]]])(
    "shows an em dash and no line for %j (fewer than 2 points)",
    (points) => {
      const { container } = render(
        <SparklineCell points={points} label="Cost trend" />,
      );

      expect(screen.getByText("—")).toBeInTheDocument();
      expect(container.querySelector("polyline")).toBeNull();
    },
  );
});
