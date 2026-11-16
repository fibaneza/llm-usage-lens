import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KeysTable } from "./KeysTable";

// Sources: docs/specs/2026-11-10-litellm.md -- LD27 (under the Organisation
// cap `keyAlias` is omitted and the UI identifies a key by the last characters
// of its token id), LD23, LT21. Format decided here: "…" + the last 4
// characters of tokenId (e.g. "…a1b2"), never the whole token id.
const base = {
  models: ["claude-sonnet"],
  spend: 2.5,
  maxBudget: 10,
  expires: null,
  blocked: false,
};

describe("KeysTable key identity (LD27)", () => {
  it("shows the alias when present", () => {
    render(
      <KeysTable
        keys={[{ ...base, tokenId: "tok-xxxxa1b2", keyAlias: "ada-laptop" }]}
        caption="Keys"
      />,
    );
    expect(screen.getByText("ada-laptop")).toBeInTheDocument();
  });

  it("a row without keyAlias shows the ellipsis plus the last 4 token characters, not the full token id", () => {
    render(
      <KeysTable
        keys={[{ ...base, tokenId: "tok-secretprefix-a1b2" }]}
        caption="Keys"
      />,
    );
    expect(screen.getByText("…a1b2")).toBeInTheDocument();
    expect(screen.queryByText(/secretprefix/)).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("a null alias is treated like an absent one (LD27)", () => {
    render(
      <KeysTable
        keys={[{ ...base, tokenId: "tok-zzzz9f8e", keyAlias: null }]}
        caption="Keys"
      />,
    );
    expect(screen.getByText("…9f8e")).toBeInTheDocument();
  });
});
