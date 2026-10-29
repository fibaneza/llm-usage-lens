import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type OnUrlUpdateFunction,
  withNuqsTestingAdapter,
} from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import { inclusiveSpanDays, resolvePreset } from "@/lib/date-range";

import { DateRangePicker } from "./DateRangePicker";

// Renders the picker behind nuqs's testing adapter so URL reads/writes can be
// asserted without a router (design-system — Date Filtering: selection persists
// in the URL via nuqs).
function renderWithUrl(
  searchParams: Record<string, string>,
  onUrlUpdate?: OnUrlUpdateFunction,
) {
  return render(<DateRangePicker />, {
    wrapper: withNuqsTestingAdapter({ searchParams, onUrlUpdate }),
  });
}

describe("DateRangePicker", () => {
  it("marks the 30-day preset active when the URL carries no range", () => {
    renderWithUrl({});
    expect(
      screen.getByRole("button", { name: /last 30 days/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /last 7 days/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("reflects a preset range carried in the URL", () => {
    const sevenDays = resolvePreset("7d");
    renderWithUrl({ dateFrom: sevenDays.dateFrom, dateTo: sevenDays.dateTo });
    expect(
      screen.getByRole("button", { name: /last 7 days/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("marks the custom trigger active for a non-preset range", () => {
    renderWithUrl({ dateFrom: "2026-01-01", dateTo: "2026-01-20" });
    expect(
      screen.getByRole("button", { name: /custom date range/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("writes the selected preset's range to the URL", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    renderWithUrl({}, onUrlUpdate);

    await user.click(screen.getByRole("button", { name: /last 7 days/i }));

    expect(onUrlUpdate).toHaveBeenCalledTimes(1);
    const firstCall = onUrlUpdate.mock.calls[0];
    if (!firstCall) throw new Error("onUrlUpdate was not called");
    const { searchParams } = firstCall[0];
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    expect(dateFrom).toBeTruthy();
    expect(dateTo).toBeTruthy();
    if (!dateFrom || !dateTo) throw new Error("range not written to URL");
    expect(inclusiveSpanDays({ dateFrom, dateTo })).toBe(7);
  });
  // Audit A1: URL-supplied dateFrom/dateTo are untrusted input. A malformed
  // value must not crash the top bar, and the 90-day cap (Rule 20.8) and
  // endpoint order must hold for URL ranges as well as calendar selections.
  describe("untrusted URL ranges", () => {
    it("falls back to the default 30D preset for a malformed dateFrom without throwing", () => {
      expect(() =>
        renderWithUrl({ dateFrom: "garbage", dateTo: "2026-01-01" }),
      ).not.toThrow();
      expect(
        screen.getByRole("button", { name: /last 30 days/i }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("falls back to the default 30D preset for a malformed dateTo without throwing", () => {
      expect(() =>
        renderWithUrl({ dateFrom: "2026-01-01", dateTo: "not-a-date" }),
      ).not.toThrow();
      expect(
        screen.getByRole("button", { name: /last 30 days/i }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("falls back to the default for an impossible calendar date", () => {
      expect(() =>
        renderWithUrl({ dateFrom: "2026-02-30", dateTo: "2026-03-10" }),
      ).not.toThrow();
      expect(
        screen.getByRole("button", { name: /last 30 days/i }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("clamps a valid but over-90-day URL range to 90 days, keeping dateTo", () => {
      renderWithUrl({ dateFrom: "2025-01-01", dateTo: "2026-01-01" });
      // 90 inclusive days ending 2026-01-01 start on 2025-10-04.
      expect(
        screen.getByRole("button", {
          name: "Custom date range: Oct 4 – Jan 1",
        }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("does not crash on a reversed URL range and never displays it reversed", () => {
      expect(() =>
        renderWithUrl({ dateFrom: "2026-01-20", dateTo: "2026-01-05" }),
      ).not.toThrow();
      const thirty = screen.getByRole("button", { name: /last 30 days/i });
      if (thirty.getAttribute("aria-pressed") !== "true") {
        // Normalised rather than defaulted: endpoints shown in ascending order.
        expect(
          screen.getByRole("button", {
            name: "Custom date range: Jan 5 – Jan 20",
          }),
        ).toHaveAttribute("aria-pressed", "true");
      }
    });
  });
  // User defect: the custom range label was unreadable in the header pill, and
  // a new start date could not be chosen (design-system — Date Filtering).
  describe("custom range label", () => {
    it("shows the full formatted range in a label that cannot clip or wrap", () => {
      renderWithUrl({ dateFrom: "2026-01-10", dateTo: "2026-01-20" });
      const trigger = screen.getByRole("button", {
        name: "Custom date range: Jan 10 – Jan 20",
      });
      const label = screen.getByText("Jan 10 – Jan 20");
      expect(trigger).toContainElement(label);
      for (const el of [trigger, label]) {
        expect(el.className).not.toMatch(
          /(^|\s)(truncate|overflow-hidden|text-ellipsis)(\s|$)/,
        );
        expect(el.className).not.toMatch(/(^|\s)(w|max-w)-(\d|\[)/);
      }
      // A label allowed to wrap inside the fixed-height pill is unreadable.
      expect(`${trigger.className} ${label.className}`).toMatch(
        /whitespace-nowrap/,
      );
    });
  });

  describe("choosing a custom range", () => {
    async function pickRange(startDay: number, endDay: number) {
      const user = userEvent.setup();
      const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
      renderWithUrl(
        { dateFrom: "2026-01-10", dateTo: "2026-01-20" },
        onUrlUpdate,
      );
      await user.click(
        screen.getByRole("button", { name: /custom date range/i }),
      );
      for (const day of [startDay, endDay]) {
        const [cell] = await screen.findAllByRole("button", {
          name: new RegExp(`January ${day}(st|nd|rd|th), 2026`),
        });
        if (!cell) throw new Error(`day ${day} not rendered`);
        await user.click(cell);
      }
      const last = onUrlUpdate.mock.calls.at(-1);
      if (!last) throw new Error("onUrlUpdate was not called");
      const { searchParams } = last[0];
      return {
        dateFrom: searchParams.get("dateFrom"),
        dateTo: searchParams.get("dateTo"),
      };
    }

    it("takes a start date after the current end, then the end date", async () => {
      expect(await pickRange(25, 28)).toEqual({
        dateFrom: "2026-01-25",
        dateTo: "2026-01-28",
      });
    });

    it("takes a start date inside the current range, then the end date", async () => {
      expect(await pickRange(12, 15)).toEqual({
        dateFrom: "2026-01-12",
        dateTo: "2026-01-15",
      });
    });

    it("takes a start date earlier than the current range, then the end date", async () => {
      expect(await pickRange(2, 5)).toEqual({
        dateFrom: "2026-01-02",
        dateTo: "2026-01-05",
      });
    });

    it("orders the range when the later day is clicked first", async () => {
      expect(await pickRange(28, 25)).toEqual({
        dateFrom: "2026-01-25",
        dateTo: "2026-01-28",
      });
    });

    it("discards a pending start when the popover closes without a second click", async () => {
      const user = userEvent.setup();
      const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
      renderWithUrl(
        { dateFrom: "2026-01-10", dateTo: "2026-01-20" },
        onUrlUpdate,
      );
      const trigger = screen.getByRole("button", {
        name: /custom date range/i,
      });
      await user.click(trigger);
      const [first] = await screen.findAllByRole("button", {
        name: /January 25(st|nd|rd|th), 2026/,
      });
      if (!first) throw new Error("day 25 not rendered");
      await user.click(first);
      await user.keyboard("{Escape}");
      expect(onUrlUpdate).not.toHaveBeenCalled();

      // Reopened: the next click must start a fresh range, not finish the old one.
      await user.click(trigger);
      const [second] = await screen.findAllByRole("button", {
        name: /January 28(st|nd|rd|th), 2026/,
      });
      if (!second) throw new Error("day 28 not rendered");
      await user.click(second);
      expect(onUrlUpdate).not.toHaveBeenCalled();
    });
  });
});
