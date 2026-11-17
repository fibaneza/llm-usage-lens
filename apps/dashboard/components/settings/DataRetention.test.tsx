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

  // System Architecture - "Configuration file" (v1 keys: data.retention
  // .dailyRollupDays, default 365, shown on Settings -> Sync and data with its
  // source); Design System - Settings Page ("Data retention: TTL configuration
  // display ... the value and its source"). Props are optional so the
  // pre-CFG call `<DataRetention />` keeps meaning 365 days, source default.
  it("shows the configured value and says it is set in config.yaml", () => {
    render(<DataRetention days={730} source="file" />);
    expect(screen.getByText(/730 days/)).toBeInTheDocument();
    expect(screen.queryByText(/365 days/)).not.toBeInTheDocument();
    expect(screen.getByText(/set in config\.yaml/i)).toBeInTheDocument();
  });

  it("with the default source shows 365 days and no config.yaml note", () => {
    render(<DataRetention days={365} source="default" />);
    expect(screen.getByText(/365 days/)).toBeInTheDocument();
    expect(screen.queryByText(/set in config\.yaml/i)).not.toBeInTheDocument();
  });
});
