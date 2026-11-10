import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
});
