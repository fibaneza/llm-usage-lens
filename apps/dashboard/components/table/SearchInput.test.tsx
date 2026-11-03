import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchInput } from "./SearchInput";

// Design System -- Component Inventory, `SearchInput`: "Debounced text filter
// for tables" (shadcn Input). Default debounce 300 ms. Fake timers drive the
// clock (Rule 60.24); events use fireEvent because user-event's async wrapper
// waits on real timers.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderInput(props: Partial<Parameters<typeof SearchInput>[0]> = {}) {
  const onChange = vi.fn<(value: string) => void>();
  render(
    <SearchInput
      value=""
      onChange={onChange}
      placeholder="Search by name"
      {...props}
    />,
  );
  return { onChange, input: screen.getByPlaceholderText("Search by name") };
}

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("SearchInput", () => {
  it("renders an input that has an accessible label", () => {
    const { input } = renderInput();

    const labelled =
      (input as HTMLInputElement).labels?.length ||
      input.getAttribute("aria-label") ||
      input.getAttribute("aria-labelledby");
    expect(labelled).toBeTruthy();
  });

  it("shows the current value", () => {
    const { input } = renderInput({ value: "alpha" });

    expect(input).toHaveValue("alpha");
  });

  it("shows typed text immediately but fires onChange only after the debounce delay", () => {
    const { onChange, input } = renderInput();

    type(input, "abc");

    expect(input).toHaveValue("abc");
    advance(299);
    expect(onChange).not.toHaveBeenCalled();
    advance(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("abc");
  });

  it("restarts the delay on each keystroke and fires once with the last value", () => {
    const { onChange, input } = renderInput();

    type(input, "a");
    advance(200);
    type(input, "ab");
    advance(200);
    expect(onChange).not.toHaveBeenCalled();
    advance(100);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("ab");
  });

  it("honours a custom delayMs", () => {
    const { onChange, input } = renderInput({ delayMs: 100 });

    type(input, "x");
    advance(99);
    expect(onChange).not.toHaveBeenCalled();
    advance(1);

    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("does not fire onChange on mount", () => {
    const { onChange } = renderInput({ value: "alpha" });

    advance(1000);

    expect(onChange).not.toHaveBeenCalled();
  });
});
