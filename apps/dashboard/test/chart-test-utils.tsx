import { act, render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

// jsdom has no layout, so Recharts' ResponsiveContainer measures 0x0 and draws
// nothing. This stub reports a fixed size the moment the container is observed,
// so the real ResponsiveContainer renders the real chart (Rule 40.3, 60.11).
class SizedResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: { width: 600, height: 300 },
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}

  disconnect() {}
}

// Pair with `vi.useFakeTimers()` in beforeEach and
// `vi.useRealTimers(); vi.unstubAllGlobals();` in afterEach (Rule 60.24).
export function stubSizedResizeObserver() {
  vi.stubGlobal("ResizeObserver", SizedResizeObserver);
}

// Recharts draws series shapes after its entrance animation; advance the fake
// clock so the final SVG is in the DOM without any wall-clock waiting.
export async function renderChart(ui: ReactElement): Promise<RenderResult> {
  const result = render(ui);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  return result;
}

// Elements carrying `text` that sit inside a visually hidden (`sr-only`)
// region -- the screen-reader copy of a chart's data.
export function srOnlyMatches(text: string | RegExp): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>("*")).filter(
    (el) =>
      el.closest(".sr-only") !== null &&
      Array.from(el.childNodes).some(
        (node) =>
          node.nodeType === Node.TEXT_NODE &&
          (typeof text === "string"
            ? (node.textContent ?? "").includes(text)
            : text.test(node.textContent ?? "")),
      ),
  );
}

export function seriesFills(container: HTMLElement, selector: string) {
  return Array.from(container.querySelectorAll(selector)).map((el) =>
    el.getAttribute("fill"),
  );
}
