import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Alert, AlertDescription, AlertTitle } from "./alert";

// Design System -- Component Inventory, `Alert` (2026-11-16): inline notices
// and section errors. Default role is `alert`; callers may set another role
// (the Services/Users "model usage only" note is `role=note`).
describe("Alert", () => {
  it("renders title and description inside role=alert by default", () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load Cost trend.</AlertTitle>
        <AlertDescription>Try again.</AlertDescription>
      </Alert>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load Cost trend.");
    expect(alert).toHaveTextContent("Try again.");
    expect(alert).toHaveClass("text-destructive");
  });

  it("lets the caller set another role such as note", () => {
    render(
      <Alert role="note">
        <AlertDescription>Model usage only.</AlertDescription>
      </Alert>,
    );

    expect(screen.getByRole("note")).toHaveTextContent("Model usage only.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
