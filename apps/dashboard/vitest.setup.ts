import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Files that opt into `// @vitest-environment node` (the infra/ CDK tests) run
// this same setup file without a DOM, so every DOM shim below is guarded.
const hasDom = typeof window !== "undefined";

// jsdom ships no matchMedia; shadcn's useIsMobile (and other responsive hooks)
// read it, so provide a non-matching stub for the default (desktop) viewport.
if (hasDom && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom ships no ResizeObserver; cmdk (the CommandMenu) constructs one on mount.
// Provide a no-op stub so the command dialog renders under test.
if (hasDom && !globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom does not implement scrollIntoView; cmdk calls it when it auto-selects
// the active command item. No-op it so the command dialog renders under test.
if (hasDom && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom implements no Pointer Capture API; Radix dropdown/popover triggers call
// these on pointer interactions. Stub them so those menus open under test.
if (hasDom && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false;
  };
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
}

// Unmount React trees between tests so the jsdom document never leaks state
// across cases (Rule 60.24 -- no flaky tests).
// Then flush one animation frame: a Recharts store created under real timers
// arms a 100 ms fallback timer (Redux Toolkit raf batching) that calls
// cancelAnimationFrame; its own rAF callback must clear it before the file
// ends. Stores created under fake timers are handled by teardownChartTest.
afterEach(async () => {
  if (!hasDom) return;
  cleanup();
  if (vi.isFakeTimers()) return;
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
});
