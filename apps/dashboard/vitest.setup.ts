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

// Unmount React trees between tests so the jsdom document never leaks state
// across cases (Rule 60.24 — no flaky tests).
afterEach(() => {
  cleanup();
});
