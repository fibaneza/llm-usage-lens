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

// Design System - Destructive (changed 2026-11-15, F13): the fill carries white
// button text and is also used as text on the page and card, so it reaches
// 4.5:1 on white and on --color-background.
describe("destructive token (WCAG AA 4.5:1)", () => {
  it("--color-destructive is #BE123C", () => {
    expect(token("destructive").toLowerCase()).toBe("#be123c");
  });

  it("destructive against white and the page background", () => {
    expect(contrast(token("destructive"), "#FFFFFF")).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrast(token("destructive"), token("background")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("destructive-foreground on the destructive fill", () => {
    expect(
      contrast(token("destructive-foreground"), token("destructive")),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

// Design System -- Color Palette (compact refresh, 2026-11-16): the palette
// values are stated in the spec table, so a drift fails here.
describe("compact-refresh palette values", () => {
  it.each([
    ["background", "#F8FAFC"],
    ["muted", "#F1F5F9"],
    ["accent", "#F1F5F9"],
    ["secondary", "#F1F5F9"],
    ["secondary-foreground", "#0F172A"],
    ["primary-subtle", "#EEF2FF"],
    ["link", "#4338CA"],
    ["input", "#8391A7"],
    ["focus-ring", "#4F46E5"],
    ["success-text", "#047857"],
    ["sidebar-accent", "#F1F5F9"],
    ["sidebar-ring", "#4F46E5"],
  ])("--color-%s is %s", (name, hex) => {
    expect(token(name).toLowerCase()).toBe(hex.toLowerCase());
  });
});

// Design System -- Color Palette: stated ratios for the compact-refresh tokens.
describe("compact-refresh token contrast", () => {
  it("secondary-foreground on the neutral secondary fill (16.30:1)", () => {
    expect(
      contrast(token("secondary-foreground"), token("secondary")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["card", "background"])("link text on %s", (surface) => {
    expect(contrast(token("link"), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["card", "background"])("success-text on %s", (surface) => {
    expect(
      contrast(token("success-text"), token(surface)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // Review round 1 W5 (WCAG 1.4.3): the Badge `warning` variant is small text;
  // amber #D97706 is ~3:1, so the text uses a darker `--color-warning-text`.
  it.each(["card", "background"])("warning-text on %s", (surface) => {
    expect(
      contrast(token("warning-text"), token(surface)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("foreground on primary-subtle", () => {
    expect(
      contrast(token("foreground"), token("primary-subtle")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("muted-foreground on primary-subtle", () => {
    expect(
      contrast(token("muted-foreground"), token("primary-subtle")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // WCAG 1.4.11: field and switch-track boundaries are 3:1 against the card.
  it("input boundary on card", () => {
    expect(contrast(token("input"), token("card"))).toBeGreaterThanOrEqual(3);
  });

  // WCAG 1.4.11: the keyboard focus indicator against every surface it sits on.
  it.each(["card", "background", "muted", "sidebar"])(
    "focus-ring on %s",
    (surface) => {
      expect(
        contrast(token("focus-ring"), token(surface)),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it("success keeps the icon-only 3:1 on card", () => {
    expect(contrast(token("success"), token("card"))).toBeGreaterThanOrEqual(3);
  });
});

// Design System -- Typography / Layout / Elevation (compact refresh): density
// tokens live in globals.css and primitives consume only these names.
describe("density tokens", () => {
  function declaration(name: string): string {
    const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
    if (!match?.[1]) throw new Error(`token ${name} is not declared`);
    return match[1].trim();
  }

  it.each([
    ["--text-cell", "0.8125rem"],
    ["--text-kpi", "1.25rem"],
    ["--spacing-control", "2rem"],
    ["--spacing-touch", "2.75rem"],
    ["--spacing-row", "2.25rem"],
    ["--spacing-row-media", "2.5rem"],
    ["--spacing-row-head", "2rem"],
    ["--spacing-card", "1rem"],
    ["--spacing-card-tight", "0.75rem"],
    ["--spacing-section", "1.5rem"],
    ["--radius-card", "0.5rem"],
    ["--radius-control", "0.375rem"],
  ])("%s is %s", (name, value) => {
    expect(declaration(name)).toBe(value);
  });

  it("declares an overlay shadow for popovers, menus, dialogs and the sheet", () => {
    expect(declaration("--shadow-overlay")).toMatch(/rgb\(/);
  });

  // Rule 60.30 / Design System -- Animation: reduced motion floor in the base layer.
  it("zeroes animation and transition durations under prefers-reduced-motion", () => {
    const start = css.search(/@media \(prefers-reduced-motion:\s*reduce\)/);
    expect(start).toBeGreaterThanOrEqual(0);
    const block = css.slice(start, start + 500);
    expect(block).toMatch(/animation-duration:\s*0\.01ms/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms/);
  });
});
