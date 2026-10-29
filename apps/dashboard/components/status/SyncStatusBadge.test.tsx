import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SyncStatusBadge } from "./SyncStatusBadge";

// A missing SyncStatus item is the neutral "never synced" state, announced as
// a polite `status` region — not an alert (Rule 20.9).
describe("SyncStatusBadge", () => {
  it("is a status named for the never-synced state", () => {
    render(<SyncStatusBadge />);

    expect(
      screen.getByRole("status", { name: "Sync status: no sync yet" }),
    ).toBeInTheDocument();
  });

  it("is neutral, not an alert", () => {
    render(<SyncStatusBadge />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses the same text for its aria-label and title", () => {
    render(<SyncStatusBadge />);

    const badge = screen.getByLabelText(/^Sync status/);
    expect(badge.getAttribute("aria-label")).not.toBeNull();
    expect(badge.getAttribute("title")).toBe(badge.getAttribute("aria-label"));
  });
});
