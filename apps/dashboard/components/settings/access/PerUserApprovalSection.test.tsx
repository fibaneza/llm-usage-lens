import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ALICE,
  fail,
  ok,
  page,
  stubAccessApi,
} from "@/test/fakes/access-ui-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { PerUserApprovalSection } from "./PerUserApprovalSection";

// Source: docs/specs/2026-11-10-access-control.md - "Visibility and
// inheritance" (organisation cap = the per-user approval gate: until an
// internal-admin records the works-council / data-protection approval - who,
// when, reference; audited - every caller sees per-user counts only),
// "API routes (additions)" (/api/governance/per-user-approval GET (admin or
// auditor) -> { approved: false } | { approved: true, approvedBy, approvedAt,
// reference, version }; PUT { reference, version } internal-admin). The spec
// defines no withdrawal, so there is no revoke control. Design System -
// Settings Page ("Per-user approval").
//
// Module under test: `components/settings/access/PerUserApprovalSection.tsx`
//   <PerUserApprovalSection canEdit={boolean} />
// - Form: input "Reference" and a submit button "Record approval" (first
//   time) / "Update approval" (when already approved).
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const APPROVED = {
  approved: true,
  approvedBy: "oid-alice",
  approvedAt: "2026-11-12T08:30:00.000Z",
  reference: "WC-2026-114",
  version: 2,
};

describe("PerUserApprovalSection", () => {
  it("says the approval is missing and that per-user cost shows counts only", async () => {
    stubAccessApi({
      "GET /api/governance/per-user-approval": { approved: false },
    });
    renderWithProviders(<PerUserApprovalSection canEdit />);
    expect(await screen.findByText(/not approved/i)).toBeVisible();
    expect(screen.getByText(/counts only/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Record approval" }),
    ).toBeInTheDocument();
  });

  it("shows who approved, when and the reference", async () => {
    stubAccessApi({
      "GET /api/governance/per-user-approval": APPROVED,
      "GET /api/identities": page([ALICE]),
    });
    renderWithProviders(<PerUserApprovalSection canEdit />);
    expect(await screen.findByText("WC-2026-114")).toBeVisible();
    expect(screen.getByText(/Alice Adams/)).toBeVisible();
    expect(screen.getByText(/2026-11-12/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Update approval" }),
    ).toBeInTheDocument();
  });

  it("records the first approval with version 0", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi({
      "GET /api/governance/per-user-approval": { approved: false },
      "PUT /api/governance/per-user-approval": () =>
        ok({ ...APPROVED, version: 1 }),
    });
    renderWithProviders(<PerUserApprovalSection canEdit />);
    await user.type(await screen.findByLabelText("Reference"), "WC-2026-114");
    await user.click(screen.getByRole("button", { name: "Record approval" }));
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          method: "PUT",
          path: "/api/governance/per-user-approval",
          body: { reference: "WC-2026-114", version: 0 },
        }),
      ]),
    );
  });

  it("updates an existing approval with its version", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi({
      "GET /api/governance/per-user-approval": APPROVED,
      "PUT /api/governance/per-user-approval": () =>
        ok({ ...APPROVED, reference: "WC-2026-200", version: 3 }),
    });
    renderWithProviders(<PerUserApprovalSection canEdit />);
    const field = await screen.findByLabelText("Reference");
    await user.clear(field);
    await user.type(field, "WC-2026-200");
    await user.click(screen.getByRole("button", { name: "Update approval" }));
    await vi.waitFor(() =>
      expect(api.writes()[0]?.body).toEqual({
        reference: "WC-2026-200",
        version: 2,
      }),
    );
  });

  it("requires a reference and caps it at 200 characters", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi({
      "GET /api/governance/per-user-approval": { approved: false },
    });
    renderWithProviders(<PerUserApprovalSection canEdit />);
    await screen.findByLabelText("Reference");
    await user.click(screen.getByRole("button", { name: "Record approval" }));
    expect(await screen.findByText(/reference is required/i)).toBeVisible();
    expect(screen.getByLabelText("Reference")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await user.click(screen.getByLabelText("Reference"));
    await user.paste("x".repeat(201));
    await user.click(screen.getByRole("button", { name: "Record approval" }));
    expect(await screen.findByText(/200/)).toBeVisible();
    expect(api.writes()).toEqual([]);
  });

  it("shows the reload message on a stale version", async () => {
    const user = userEvent.setup();
    stubAccessApi({
      "GET /api/governance/per-user-approval": APPROVED,
      "PUT /api/governance/per-user-approval": () => fail(409, "CONFLICT"),
    });
    renderWithProviders(<PerUserApprovalSection canEdit />);
    await screen.findByLabelText("Reference");
    await user.click(screen.getByRole("button", { name: "Update approval" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/reload/i);
  });

  it("is read-only for an auditor: state shown, no form", async () => {
    stubAccessApi({ "GET /api/governance/per-user-approval": APPROVED });
    renderWithProviders(<PerUserApprovalSection canEdit={false} />);
    expect(await screen.findByText("WC-2026-114")).toBeVisible();
    expect(screen.queryByLabelText("Reference")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /(record|update) approval/i }),
    ).not.toBeInTheDocument();
  });
});
