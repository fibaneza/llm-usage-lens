import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DataRetention } from "./DataRetention";

// Source: implementation-phases Phase 4.9 (data retention, read-only); Data
// Model -- "TTL and Data Retention" (DailyRollup TTL 365 days, configurable per
// deployment). Module under test: `components/settings/DataRetention.tsx`, a
// static component with no props and no controls.
describe("DataRetention", () => {
  it("states the 365-day DailyRollup TTL and that it is deployment-configured", () => {
    render(<DataRetention />);
    expect(screen.getByText(/365 days/)).toBeInTheDocument();
    expect(screen.getByText(/last updated/i)).toBeInTheDocument();
    expect(screen.getByText(/DailyRollup/)).toBeInTheDocument();
    expect(screen.getByText(/per deployment|deployment/i)).toBeInTheDocument();
  });

  it("is read-only: no inputs or buttons", () => {
    render(<DataRetention />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
