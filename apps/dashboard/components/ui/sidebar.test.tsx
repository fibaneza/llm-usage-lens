import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Source: docs/specs/2026-11-10-access-control.md - BP-D12 and T40 (the one
// client-side cookie, sidebar_state, gets path=<prefix> when a base path is
// set so it is not sent to the other application on a shared host); without a
// prefix it stays path=/. Test of unit BP (components/ui/sidebar.tsx).
async function toggleAndCaptureCookie(prefix: string): Promise<string> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", prefix);
  const { SidebarProvider } = await import("./sidebar");
  const written: string[] = [];
  vi.spyOn(document, "cookie", "set").mockImplementation((value) => {
    written.push(value);
  });
  render(
    <SidebarProvider>
      <div />
    </SidebarProvider>,
  );
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  const cookie = written.find((c) => c.startsWith("sidebar_state="));
  if (cookie === undefined) throw new Error("sidebar_state was not written");
  return cookie;
}

describe("sidebar_state cookie path (BP-D12, T40)", () => {
  it("is scoped to the base path when one is set", async () => {
    const cookie = await toggleAndCaptureCookie("/llm-lens");
    expect(cookie).toMatch(/;\s*path=\/llm-lens(;|$)/);
  });

  it("stays path=/ without a base path", async () => {
    const cookie = await toggleAndCaptureCookie("");
    expect(cookie).toMatch(/;\s*path=\/(;|$)/);
  });
});
