import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountIdBadge } from "./AccountIdBadge";

// Source: Design System -- Component Inventory (`AccountIdBadge`: formatted AWS
// account ID with copy button, 123-456-789-012); implementation-phases Phase 4.6
// ("Tests: AccountIdBadge copy functionality"); Rule 60.30 (icon-only controls
// carry an aria-label); Rule 60.24 (no real clipboard / no wall clock).
// Contract: `<AccountIdBadge accountId="123456789012" />`.
function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AccountIdBadge", () => {
  it("formats a 12-digit id as 123-456-789-012", () => {
    render(<AccountIdBadge accountId="123456789012" />);

    expect(screen.getByText("123-456-789-012")).toBeInTheDocument();
  });

  it("keeps leading zeros", () => {
    render(<AccountIdBadge accountId="000000000000" />);

    expect(screen.getByText("000-000-000-000")).toBeInTheDocument();
  });

  it("has an icon-only copy button with an accessible name", () => {
    render(<AccountIdBadge accountId="123456789012" />);

    const button = screen.getByRole("button", { name: /copy/i });
    expect(button).toHaveAccessibleName(/account id/i);
    expect(button).toHaveTextContent("");
  });

  it("copies the raw, unformatted id to the clipboard", async () => {
    const writeText = stubClipboard();
    render(<AccountIdBadge accountId="123456789012" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("123456789012");
  });

  it("announces the copied state in a polite status region", async () => {
    stubClipboard();
    render(<AccountIdBadge accountId="123456789012" />);
    expect(screen.getByRole("status")).not.toHaveTextContent(/copied/i);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    });

    expect(screen.getByRole("status")).toHaveTextContent(/copied/i);
  });

  it("does not announce copied when the clipboard write fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
      configurable: true,
    });
    render(<AccountIdBadge accountId="123456789012" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    });

    expect(screen.getByRole("status")).not.toHaveTextContent(/copied/i);
  });

  it("clears the copied state after a short delay", async () => {
    vi.useFakeTimers();
    stubClipboard();
    render(<AccountIdBadge accountId="123456789012" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/copied/i);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByRole("status")).not.toHaveTextContent(/copied/i);
  });

  // Rule 60.17: a failed copy is a handled, announced state, not a silent no-op.
  it("announces 'Copy failed' (not 'Copied') when the clipboard write rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
      configurable: true,
    });
    render(<AccountIdBadge accountId="123456789012" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    });

    expect(screen.getByRole("status")).toHaveTextContent(/copy failed/i);
    expect(screen.getByRole("status")).not.toHaveTextContent(/^copied$/i);
  });

  it("announces 'Copy failed' without throwing when navigator.clipboard is undefined", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    render(<AccountIdBadge accountId="123456789012" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    });

    expect(screen.getByRole("status")).toHaveTextContent(/copy failed/i);
  });

  it("clears the 'Copy failed' message after the same short delay", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
      configurable: true,
    });
    render(<AccountIdBadge accountId="123456789012" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/copy failed/i);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByRole("status")).not.toHaveTextContent(/copy failed/i);
  });
});
