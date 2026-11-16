import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KeyValueList } from "./KeyValueList";

// Design System -- Layout, Key-value lists (2026-11-16): `<dl>`, muted 13px
// label column, 13px value (mono for IDs and numbers), 32px rows.
describe("KeyValueList", () => {
  it("renders each term with its value as a description list", () => {
    render(
      <KeyValueList
        items={[
          { term: "Last run", value: "2026-11-15 03:00 UTC" },
          { term: "Accounts processed", value: <strong>12</strong> },
        ]}
      />,
    );

    const terms = screen.getAllByRole("term");
    const definitions = screen.getAllByRole("definition");
    expect(terms.map((t) => t.textContent)).toEqual([
      "Last run",
      "Accounts processed",
    ]);
    expect(definitions.map((d) => d.textContent)).toEqual([
      "2026-11-15 03:00 UTC",
      "12",
    ]);
    expect(terms[0]?.closest("dl")).not.toBeNull();
  });

  it("uses the monospace face only for items marked mono", () => {
    render(
      <KeyValueList
        items={[
          { term: "Base URL", value: "https://gw.example.test" },
          { term: "Account", value: "123456789012", mono: true },
        ]}
      />,
    );

    const [plain, mono] = screen.getAllByRole("definition");
    expect(plain).not.toHaveClass("font-mono");
    expect(mono).toHaveClass("font-mono");
  });

  it("styles terms muted and values at 13px", () => {
    render(<KeyValueList items={[{ term: "Edition", value: "OSS" }]} />);

    expect(screen.getByRole("term")).toHaveClass("text-muted-foreground");
    expect(screen.getByRole("term")).toHaveClass("text-cell");
    expect(screen.getByRole("definition")).toHaveClass("text-cell");
  });
});
