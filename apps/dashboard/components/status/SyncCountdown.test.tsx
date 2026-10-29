import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SyncCountdown } from "./SyncCountdown";

// WAI-ARIA timer pattern: a countdown is a `timer` (implicit aria-live="off",
// so it does not announce every tick), not a `status` live region. Until a sync
// exists it is the neutral "pending" state, never an error (Rule 20.9).
describe("SyncCountdown", () => {
  it("is a timer named for the pending next sync", () => {
    render(<SyncCountdown />);

    expect(
      screen.getByRole("timer", { name: "Next sync: pending" }),
    ).toBeInTheDocument();
  });

  it("is not a status live region", () => {
    render(<SyncCountdown />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not opt back in to live announcements", () => {
    render(<SyncCountdown />);

    const countdown = screen.getByLabelText(/^Next sync/);
    expect(countdown.getAttribute("aria-live") ?? "off").toBe("off");
  });

  it("uses the same text for its aria-label and title", () => {
    render(<SyncCountdown />);

    const countdown = screen.getByLabelText(/^Next sync/);
    expect(countdown.getAttribute("aria-label")).not.toBeNull();
    expect(countdown.getAttribute("title")).toBe(
      countdown.getAttribute("aria-label"),
    );
  });
});
