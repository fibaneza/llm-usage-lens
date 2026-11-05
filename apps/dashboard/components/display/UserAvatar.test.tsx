import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserAvatar } from "./UserAvatar";

// Source: Design System -- Component Inventory (`UserAvatar`: initials avatar
// with consistent color per user); implementation-phases Phase 4.6 ("Tests:
// UserAvatar color consistency"); Rule 40.2 / 60.30 (semantic tokens, no raw
// hex). Contract: `<UserAvatar userId="alice.smith@corp.com" />` renders a
// decorative (aria-hidden) element -- the adjacent name carries the identity --
// whose text is the initials and whose inline `background-color` is
// `var(--color-avatar-N)`, N in 1..8, a family dedicated to avatars (never a
// model, team or non-model token). The token is a pure function of `userId`.
// Ambiguity resolved: the design system defines no user palette, so this test
// pins a new `--color-avatar-1..8` family in globals.css (spec note needed).
const TOKEN = /^var\(--color-avatar-[1-8]\)$/;

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

  it("colors by a dedicated avatar token, never raw hex", () => {
    expect(renderAvatar("alice").color).toMatch(TOKEN);
    expect(renderAvatar("zed").color).toMatch(TOKEN);
  });

  it("gives the same user the same color on every render", () => {
    const colors = Array.from({ length: 5 }, () => renderAvatar("alice").color);

    expect(new Set(colors).size).toBe(1);
  });

  it("can give different users different colors", () => {
    const ids = ["alice", "bob", "carol", "dave", "erin", "frank", "grace"];
    const colors = new Set(ids.map((id) => renderAvatar(id).color));

    expect(colors.size).toBeGreaterThan(1);
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
