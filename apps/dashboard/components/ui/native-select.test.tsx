import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { NativeSelect } from "@/components/ui/native-select";

// Source: docs/specs/2026-05-15-design-system.md - Component Inventory row
// NativeSelect and its tests T-FX6 (the component) and T-FX7 (every select on
// the page uses it); plan unit FX2, Fix 1.
function renderSelect(props: Record<string, unknown> = {}) {
  return render(
    <label>
      Role
      <NativeSelect defaultValue="a" {...props}>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </NativeSelect>
    </label>,
  );
}

describe("NativeSelect (T-FX6)", () => {
  it("drops the browser arrow and pads the right for one chevron icon", () => {
    renderSelect();
    const select = screen.getByRole("combobox", { name: "Role" });
    const tokens = select.className.split(/\s+/);
    expect(tokens).toContain("appearance-none");
    expect(tokens.some((t) => /^pr-(8|9|10)$/.test(t))).toBe(true);

    const wrapper = select.parentElement as HTMLElement;
    const chevrons = wrapper.querySelectorAll("svg");
    expect(chevrons).toHaveLength(1);
    expect(chevrons[0]).toHaveAttribute("aria-hidden", "true");
    expect(chevrons[0]?.getAttribute("class")).toMatch(/pointer-events-none/);
  });

  it("keeps the label's accessible name and native keyboard selection", async () => {
    renderSelect();
    const select = screen.getByRole("combobox", { name: "Role" });
    await userEvent.selectOptions(select, "b");
    expect(select).toHaveValue("b");
  });

  it("dims when disabled", () => {
    renderSelect({ disabled: true });
    const select = screen.getByRole("combobox", { name: "Role" });
    expect(select).toBeDisabled();
    expect(select.className).toMatch(/disabled:opacity-50/);
  });

  it("takes the destructive border from aria-invalid", () => {
    renderSelect({ "aria-invalid": true });
    const select = screen.getByRole("combobox", { name: "Role" });
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select.className).toMatch(/aria-invalid:border-destructive/);
  });

  // T-FX6 amended (review FX2 r1, B1): the wrapper is the sized box the
  // chevron is positioned in, so a caller's width/sizing classes go to the
  // wrapper (select stays w-full inside it); every other class goes to the
  // select. Design System - NativeSelect: chevron inside the field, 12px from
  // the right edge.
  it.each(["w-36", "w-auto", "max-w-40", "min-w-0"])(
    "puts the sizing class %s on the wrapper that holds the chevron, not on the select",
    (cls) => {
      renderSelect({ className: cls });
      const select = screen.getByRole("combobox", { name: "Role" });
      const wrapper = select.parentElement as HTMLElement;
      expect(wrapper.className.split(/\s+/)).toContain(cls);
      expect(select.className.split(/\s+/)).not.toContain(cls);
      expect(select.className.split(/\s+/)).toContain("w-full");
      expect(wrapper.querySelector("svg")).not.toBeNull();
    },
  );

  it("lets the wrapper shrink (min-w-0) so a narrow container bounds the select and its chevron", () => {
    renderSelect({ className: "max-w-40" });
    const select = screen.getByRole("combobox", { name: "Role" });
    const wrapper = select.parentElement as HTMLElement;
    expect(wrapper.className.split(/\s+/)).toContain("min-w-0");
    expect(wrapper.className.split(/\s+/)).toContain("relative");
  });

  it("keeps non-sizing classes on the select and out of the wrapper", () => {
    renderSelect({ className: "w-36 text-xs" });
    const select = screen.getByRole("combobox", { name: "Role" });
    expect(select.className.split(/\s+/)).toContain("text-xs");
    expect(select.parentElement?.className.split(/\s+/)).not.toContain(
      "text-xs",
    );
  });
});

// T-FX7: no bare <select> outside the component.
const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(COMPONENTS, f).split(sep).join("/");
const source = walk(COMPONENTS).filter(
  (f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f),
);

describe("native select usage (T-FX7)", () => {
  it("only components/ui/native-select.tsx renders a bare <select", () => {
    const offenders = source
      .filter((f) => /<select[\s>]/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual(["ui/native-select.tsx"]);
  });

  it.each([
    "auth/SignInOptions.tsx",
    "table/CardSortControl.tsx",
    "settings/access/form-controls.tsx",
    "litellm/team/native-select.tsx",
  ])("%s renders the shared NativeSelect", (file) => {
    const text = readFileSync(join(COMPONENTS, file), "utf8");
    expect(text).toMatch(/@\/components\/ui\/native-select/);
    expect(text).toMatch(/<NativeSelect[\s>]/);
  });
});
