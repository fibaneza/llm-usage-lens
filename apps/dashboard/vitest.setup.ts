import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom ships no matchMedia; shadcn's useIsMobile (and other responsive hooks)
// read it, so provide a non-matching stub for the default (desktop) viewport.
if (!window.matchMedia) {
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
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom does not implement scrollIntoView; cmdk calls it when it auto-selects
// the active command item. No-op it so the command dialog renders under test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// Unmount React trees between tests so the jsdom document never leaks state
// across cases (Rule 60.24 — no flaky tests).
afterEach(() => {
  cleanup();
});
