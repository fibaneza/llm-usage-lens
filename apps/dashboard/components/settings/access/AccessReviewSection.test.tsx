import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccessReviewSection } from "./AccessReviewSection";

// Source: docs/specs/2026-11-10-access-control.md - "Access review"
// (quarterly; internal-admin, internal-auditor: CSV of every identity with
// roles and sources, member team and admin scopes with sources, lastSignInAt,
// aliases, the LiteLLM link and flags (ambiguous, overage, stale, Entra role
// removed while an in-app grant remains); the export is audited), "API routes
// (additions)" (/api/access-review GET, text/csv, Content-Disposition
// attachment, Cache-Control no-store). Design System - Settings Page ("Access
// review export").
//
// Module under test: `components/settings/access/AccessReviewSection.tsx`
//   <AccessReviewSection />
// The export is a same-origin download link (the browser follows the route's
// Content-Disposition), not a client-side fetch of a CSV into memory.
describe("AccessReviewSection", () => {
  it("offers the CSV as a same-origin download link", () => {
    render(<AccessReviewSection />);
    const link = screen.getByRole("link", { name: /export access review/i });
    expect(link).toHaveAttribute("href", "/api/access-review");
    expect(link).toHaveAttribute("download");
  });

  it("tells the reader what the export holds and that it is audited", () => {
    render(<AccessReviewSection />);
    expect(
      screen.getAllByText(/audited|recorded in the audit log/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/csv/i).length).toBeGreaterThan(0);
  });
});

// Unit BP, Platform spec - Base path: BP-D3, BP-D13 (the raw download link is
// one of the four sites that use withBasePath). The prefixed e2e smoke checks
// the same link in a browser (T11).
describe("AccessReviewSection under a base path (BP-D3)", () => {
  it("prefixes the download link", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/llm-lens");
    const { AccessReviewSection: Prefixed } =
      await import("./AccessReviewSection");
    render(<Prefixed />);
    const link = screen.getByRole("link", { name: /export access review/i });
    expect(link).toHaveAttribute("href", "/llm-lens/api/access-review");
  });
});
