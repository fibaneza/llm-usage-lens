import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Design-system spec — Accessibility: contrast 4.5:1 minimum (WCAG 1.4.3);
// Rule 60.30. Reads the real semantic tokens from globals.css so a palette
// edit that drops text contrast fails here before the axe e2e pass.
const css = readFileSync(join(__dirname, "globals.css"), "utf8");

function token(name: string): string {
  const match = css.match(
    new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`),
  );
  if (!match?.[1])
    throw new Error(`token --color-${name} is not a 6-digit hex`);
  return match[1];
}

function channel(hex: string, start: number): number {
  const v = parseInt(hex.slice(start, start + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  return (
    0.2126 * channel(h, 0) + 0.7152 * channel(h, 2) + 0.0722 * channel(h, 4)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("text token contrast (WCAG AA 4.5:1)", () => {
  const surfaces = [
    "card",
    "background",
    "muted",
    "sidebar",
    "accent",
    "sidebar-accent",
  ] as const;

  for (const surface of surfaces) {
    it(`muted-foreground on ${surface}`, () => {
      expect(
        contrast(token("muted-foreground"), token(surface)),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("foreground on card and background", () => {
    expect(contrast(token("foreground"), token("card"))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrast(token("foreground"), token("background")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("primary-foreground on primary", () => {
    expect(
      contrast(token("primary-foreground"), token("primary")),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

// WCAG 1.4.11 (non-text contrast, 3:1): the DeltaBadge arrow carries the
// success/destructive colour while its percentage text uses a text token, and
// chart series must stay distinguishable from the white card. Design System --
// Chart Colors. The team series palette `--color-team-1..8` backs
// `CostTrendChart groupBy="team"`; it is separate from the per-model tokens so
// a model's colour never means a team (Rule 40.2).
describe("non-text token contrast (WCAG 1.4.11, 3:1)", () => {
  const teamTokens = Array.from({ length: 8 }, (_, i) => `team-${i + 1}`);

  it.each(["success", "destructive"])("%s arrow on card", (name) => {
    expect(contrast(token(name), token("card"))).toBeGreaterThanOrEqual(3);
  });

  it.each(teamTokens)("%s series on card", (name) => {
    expect(contrast(token(name), token("card"))).toBeGreaterThanOrEqual(3);
  });

  it("team series tokens are distinct from each other and from the model and non-model colours", () => {
    const reserved = [
      "model-opus",
      "model-sonnet",
      "model-haiku",
      "model-other",
      "foreground",
    ].map((name) => token(name).toLowerCase());
    const team = teamTokens.map((name) => token(name).toLowerCase());

    expect(new Set(team).size).toBe(team.length);
    for (const hex of team) expect(reserved).not.toContain(hex);
  });
});

// Design System -- Avatar Colors (Per User): white initials on a per-user fill,
// so each `--color-avatar-N` needs 4.5:1 against white, and the family must not
// reuse any model, team, non-model (aliases --color-foreground) or status colour.
describe("avatar token contrast (white initials, WCAG AA 4.5:1)", () => {
  const avatarTokens = Array.from({ length: 8 }, (_, i) => `avatar-${i + 1}`);

  it.each(avatarTokens)("%s against white", (name) => {
    expect(contrast(token(name), "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("avatar tokens are distinct from each other and from model, team, non-model and status colours", () => {
    const reserved = [
      "model-opus",
      "model-sonnet",
      "model-haiku",
      "model-other",
      "foreground",
      "primary",
      "success",
      "destructive",
      ...Array.from({ length: 8 }, (_, i) => `team-${i + 1}`),
    ].map((name) => token(name).toLowerCase());
    const avatar = avatarTokens.map((name) => token(name).toLowerCase());

    expect(new Set(avatar).size).toBe(avatar.length);
    for (const hex of avatar) expect(reserved).not.toContain(hex);
  });
});
