import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RankCell } from "./RankingList";

// Design System -- Component Inventory, `RankingList`: "Leaderboard with medal
// icons". Implementation-phases Phase 4.2: "RankingList variant with medal
// icons for top 3". Ranks 1-3 get a distinct Lucide icon (aria-hidden) plus an
// accessible text label; rank 4 and below show the number. Colours stay on
// existing tokens -- no raw hex (Rule 40.2).
function exposesLabel(container: HTMLElement, label: string): boolean {
  return (
    (container.textContent ?? "").includes(label) ||
    container.querySelector(`[aria-label="${label}"]`) !== null
  );
}

describe("RankCell", () => {
  it.each([1, 2, 3])(
    "shows an aria-hidden icon and an accessible 'Rank %i' label",
    (rank) => {
      const { container } = render(<RankCell rank={rank} />);

      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(exposesLabel(container, `Rank ${rank}`)).toBe(true);
    },
  );

  it("uses a different icon for each of the top three ranks", () => {
    const icons = [1, 2, 3].map((rank) => {
      const { container, unmount } = render(<RankCell rank={rank} />);
      const markup = container.querySelector("svg")?.innerHTML;
      unmount();
      return markup;
    });

    expect(new Set(icons).size).toBe(3);
  });

  it("shows the number and no icon for rank 4", () => {
    const { container, getByText } = render(<RankCell rank={4} />);

    expect(getByText("4")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("shows a multi-digit number for a low rank", () => {
    const { getByText } = render(<RankCell rank={17} />);

    expect(getByText("17")).toBeInTheDocument();
  });

  it("uses no raw hex colour", () => {
    const { container } = render(<RankCell rank={1} />);

    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
