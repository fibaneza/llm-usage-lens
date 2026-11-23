import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { renderWithProviders } from "@/test/support/render-providers";

import { AccountForm, EMPTY_ACCOUNT_VALUES } from "./AccountForm";

// Source: D-ST5; Design System - "Settings
// small UX" > "Add account (D-ST5)": the form asks for "AWS account ID" (typed,
// 12 digits) and for Department and Team by name (or by picking an existing
// one); nobody types an internal id. Module under test:
// `components/settings/AccountForm.tsx`.
function renderForm() {
  return renderWithProviders(
    <AccountForm
      initial={EMPTY_ACCOUNT_VALUES}
      schema={z.object({})}
      submitLabel="Create account"
      pending={false}
      serverError={null}
      onSubmit={vi.fn()}
    />,
  );
}

describe("AccountForm (D-ST5)", () => {
  it("labels the typed account number 'AWS account ID'", () => {
    renderForm();
    expect(screen.getByLabelText("AWS account ID")).toBeInTheDocument();
  });

  it("asks for the department and the team by name", () => {
    renderForm();
    expect(screen.getByLabelText(/^department name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^team name/i)).toBeInTheDocument();
  });

  it("has no Department ID or Team ID input", () => {
    renderForm();
    expect(screen.queryByLabelText(/department id/i)).toBeNull();
    expect(screen.queryByLabelText(/team id/i)).toBeNull();
  });
});
