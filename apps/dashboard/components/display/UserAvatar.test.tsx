import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserAvatar } from "./UserAvatar";

// Source: Design System -- Component Inventory (`UserAvatar`, amended
// 2026-11-16: initials avatar, neutral fill, 20px in tables -- per-user colour
// carried no information); implementation-phases Phase 4.6; Rule 40.2 / 60.30
// (semantic tokens, no raw hex). Contract: `<UserAvatar userId=... />` renders a
// decorative (aria-hidden) element -- the adjacent name carries the identity --
// whose text is the initials, on `bg-muted` with foreground text, 20px. The
// `--color-avatar-1..8` family stays defined in globals.css (see below) but is
// no longer applied to the element.

function renderAvatar(userId: string) {
  const { container, unmount } = render(<UserAvatar userId={userId} />);
  const el = container.firstElementChild as HTMLElement;
  const result = {
    text: el.textContent,
    color: el.style.backgroundColor,
    hidden: el.getAttribute("aria-hidden"),
  };
  unmount();
  return result;
}

describe("UserAvatar", () => {
  it.each([
    ["alice", "A"],
    ["alice.smith@corp.com", "AS"],
    ["bob_jones", "BJ"],
    ["carol-ann-lee", "CA"],
    ["Dave Brown", "DB"],
  ])("derives uppercase initials (max two) for %s", (id, initials) => {
    expect(renderAvatar(id).text).toBe(initials);
  });

  it("is decorative", () => {
    expect(renderAvatar("alice").hidden).toBe("true");
  });

  it("renders a neutral 20px avatar: muted fill, foreground initials", () => {
    const { container } = render(<UserAvatar userId="alice" />);

    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveClass("size-5", "bg-muted", "text-foreground");
    expect(el).not.toHaveClass("text-white");
    expect(el).not.toHaveClass("size-7");
  });

  it("sets no per-user inline colour, so every user gets the same fill", () => {
    for (const id of ["alice", "zed", "carol-ann-lee"]) {
      expect(renderAvatar(id).color).toBe("");
    }
  });
});

describe("avatar color tokens in globals.css", () => {
  const css = readFileSync(
    resolve(import.meta.dirname, "../../app/globals.css"),
    "utf8",
  );

  it("defines --color-avatar-1 .. --color-avatar-8", () => {
    for (let n = 1; n <= 8; n += 1) {
      expect(css).toMatch(
        new RegExp(`--color-avatar-${n}:\\s*#[0-9a-fA-F]{6}`),
      );
    }
  });

  it("does not reuse a team token value", () => {
    const value = (name: string) =>
      css
        .match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
        ?.toLowerCase();
    const teams = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => value(`--color-team-${n}`)),
    );
    for (let n = 1; n <= 8; n += 1) {
      expect(teams.has(value(`--color-avatar-${n}`))).toBe(false);
    }
  });
});
