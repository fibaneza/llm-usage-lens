import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import NoAccessPage from "./page";

// Source: docs/specs/2026-11-10-access-control.md — Rollout / no-access state;
// contract R1 decision 9. The page needs no session and renders a full-page
// EmptyState with a link back to sign-in.
describe("/no-access page", () => {
  it("tells the user they have no access and to contact their administrator", async () => {
    render(await NoAccessPage());
    expect(
      screen.getByText(
        /You don't have access to LLM Usage Lens\. Contact your administrator\./,
      ),
    ).toBeInTheDocument();
  });

  it("offers a sign-in/sign-out link", async () => {
    render(await NoAccessPage());
    expect(
      screen.getByRole("link", { name: /sign (in|out)/i }),
    ).toHaveAttribute("href", expect.stringContaining("/sign-in"));
  });

  // Unit BP, Platform spec - Base path: BP-D3 / BP-D13 (the raw anchor is a
  // withBasePath site; Next's Link prefix does not cover it).
  it("links back to sign-in with the base path when one is set (BP-D3)", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/llm-lens");
    const { default: Prefixed } = await import("./page");
    render(await Prefixed());
    expect(
      screen.getByRole("link", { name: /sign (in|out)/i }),
    ).toHaveAttribute("href", "/llm-lens/sign-in");
  });

  it("links to the plain /sign-in with no base path (BP-D1)", async () => {
    render(await NoAccessPage());
    expect(
      screen.getByRole("link", { name: /sign (in|out)/i }),
    ).toHaveAttribute("href", "/sign-in");
  });
});
