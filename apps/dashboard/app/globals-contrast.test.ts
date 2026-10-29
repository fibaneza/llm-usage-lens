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
