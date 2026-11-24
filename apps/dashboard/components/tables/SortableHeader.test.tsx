import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnUrlUpdateFunction } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import { Table, TableHeader, TableRow } from "@/components/ui/table";
import { renderWithProviders } from "@/test/support/render-providers";

import { SortableHeader } from "./SortableHeader";

// Source: Design System - "The users table (unit US1, 2026-11-24; D-US4)": the
// shared SortableHeader in components/tables/ is a button inside the th; the
// th carries aria-sort (ascending, descending or none); a Lucide arrow is not
// the only signal; the sort lives in the URL (nuqs `sort`, `dir`). The
// contract this suite fixes (the spec leaves the props open): named export
// `SortableHeader({ sortKey, sortKeys, defaultKey?, children })`, rendering
// the th itself; `sortKeys` is the table's own allowlist (an explicit prop, not
// a module registry: Rule 40.5, and the header is reused across tables);
// `defaultKey` is the key sorted ascending while the URL has no `sort`; clicking the active key flips the direction, clicking another key
// starts it ascending.
const KEYS = ["name", "email"];

function show(
  searchParams: Record<string, string> = {},
  onUrlUpdate?: OnUrlUpdateFunction,
) {
  renderWithProviders(
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHeader sortKey="name" sortKeys={KEYS} defaultKey="name">
            Name
          </SortableHeader>
          <SortableHeader sortKey="email" sortKeys={KEYS} defaultKey="name">
            Email
          </SortableHeader>
        </TableRow>
      </TableHeader>
    </Table>,
    { searchParams, ...(onUrlUpdate ? { onUrlUpdate } : {}) },
  );
}

const header = (name: string) => screen.getByRole("columnheader", { name });

describe("SortableHeader (unit US1, D-US4)", () => {
  it("renders a button inside the th, named by the label", () => {
    show();
    const button = screen.getByRole("button", { name: "Email" });
    expect(button.closest("th")).toBe(header("Email"));
  });

  it("aria-sort follows the URL: the default key is ascending, the others none", () => {
    show();
    expect(header("Name")).toHaveAttribute("aria-sort", "ascending");
    expect(header("Email")).toHaveAttribute("aria-sort", "none");
  });

  it.each([
    ["ascending", { sort: "email", dir: "asc" }],
    ["descending", { sort: "email", dir: "desc" }],
  ])("the URL sort email %s puts that aria-sort on Email only", (state, qs) => {
    show(qs);
    expect(header("Email")).toHaveAttribute("aria-sort", state);
    expect(header("Name")).toHaveAttribute("aria-sort", "none");
  });

  it.each([
    ["an unknown sort", { sort: "bogus" }],
    ["an unknown sort with a direction", { sort: "bogus", dir: "desc" }],
  ])(
    "%s in the URL falls back to the default key ascending, the others none (readSort allowlist; unit US1, D-US4)",
    (_label, qs) => {
      show(qs);
      expect(header("Name")).toHaveAttribute("aria-sort", "ascending");
      expect(header("Email")).toHaveAttribute("aria-sort", "none");
    },
  );

  it("a Lucide arrow marks the active direction and is hidden from assistive tech (not the only signal)", () => {
    show({ sort: "email", dir: "desc" });
    const arrow = screen
      .getByRole("button", { name: "Email" })
      .querySelector("svg");
    expect(arrow).not.toBeNull();
    expect(arrow).toHaveAttribute("aria-hidden", "true");
    expect(arrow?.getAttribute("class")).toMatch(/arrow-down/);
    expect(header("Email")).toHaveAttribute("aria-sort", "descending");
  });

  it("an inactive header still shows an arrow glyph", () => {
    show();
    expect(
      screen.getByRole("button", { name: "Email" }).querySelector("svg"),
    ).not.toBeNull();
  });

  it("clicking another key starts it ascending and writes sort to the URL", async () => {
    const updates = vi.fn();
    show({}, updates);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Email" }));
    expect(header("Email")).toHaveAttribute("aria-sort", "ascending");
    expect(header("Name")).toHaveAttribute("aria-sort", "none");
    expect(updates.mock.lastCall?.[0].searchParams.get("sort")).toBe("email");
  });

  it("clicking the active key toggles the direction, both ways", async () => {
    const updates = vi.fn();
    show({ sort: "email", dir: "asc" }, updates);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Email" }));
    expect(header("Email")).toHaveAttribute("aria-sort", "descending");
    expect(updates.mock.lastCall?.[0].searchParams.get("dir")).toBe("desc");
    await user.click(screen.getByRole("button", { name: "Email" }));
    expect(header("Email")).toHaveAttribute("aria-sort", "ascending");
  });

  it("clicking the default key while it is ascending flips it to descending", async () => {
    show();
    await userEvent.setup().click(screen.getByRole("button", { name: "Name" }));
    expect(header("Name")).toHaveAttribute("aria-sort", "descending");
  });

  it("two tables with different sortKeys on one page do not affect each other (sortKeys is per table; unit US1, D-US4)", () => {
    renderWithProviders(
      <>
        <Table aria-label="first">
          <TableHeader>
            <TableRow>
              <SortableHeader
                sortKey="name"
                sortKeys={["name", "email"]}
                defaultKey="name"
              >
                Name A
              </SortableHeader>
              <SortableHeader
                sortKey="email"
                sortKeys={["name", "email"]}
                defaultKey="name"
              >
                Email A
              </SortableHeader>
            </TableRow>
          </TableHeader>
        </Table>
        <Table aria-label="second">
          <TableHeader>
            <TableRow>
              <SortableHeader
                sortKey="name"
                sortKeys={["name", "team"]}
                defaultKey="name"
              >
                Name B
              </SortableHeader>
              <SortableHeader
                sortKey="team"
                sortKeys={["name", "team"]}
                defaultKey="name"
              >
                Team B
              </SortableHeader>
            </TableRow>
          </TableHeader>
        </Table>
      </>,
      { searchParams: { sort: "email", dir: "desc" } },
    );
    expect(header("Email A")).toHaveAttribute("aria-sort", "descending");
    expect(header("Name A")).toHaveAttribute("aria-sort", "none");
    expect(header("Name B")).toHaveAttribute("aria-sort", "ascending");
    expect(header("Team B")).toHaveAttribute("aria-sort", "none");
  });
});

// Source: Design System - "Sorting in the other tables (unit SRT1, 2026-11-24;
// D-SR1)": the gateway audit source is newest first by default, so the shared
// header takes an optional `defaultDir` ('asc' | 'desc', default 'asc') that is
// the direction of the default key while the URL has no usable sort
// (coordinator ruling, 2026-11-24).
describe("SortableHeader defaultDir (unit SRT1, D-SR1)", () => {
  function showDesc(
    searchParams: Record<string, string> = {},
    onUrlUpdate?: OnUrlUpdateFunction,
  ) {
    renderWithProviders(
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader
              sortKey="time"
              sortKeys={["time", "user"]}
              defaultKey="time"
              defaultDir="desc"
            >
              Time
            </SortableHeader>
            <SortableHeader
              sortKey="user"
              sortKeys={["time", "user"]}
              defaultKey="time"
              defaultDir="desc"
            >
              User
            </SortableHeader>
          </TableRow>
        </TableHeader>
      </Table>,
      { searchParams, ...(onUrlUpdate ? { onUrlUpdate } : {}) },
    );
  }

  it("with defaultDir desc and no sort in the URL the default key is descending, with a down arrow", () => {
    showDesc();
    expect(header("Time")).toHaveAttribute("aria-sort", "descending");
    expect(header("User")).toHaveAttribute("aria-sort", "none");
    const arrow = screen
      .getByRole("button", { name: "Time" })
      .querySelector("svg");
    expect(arrow?.getAttribute("class")).toMatch(/arrow-down/);
  });

  it("clicking the default header flips it from the default and writes dir=asc to the URL", async () => {
    const updates = vi.fn();
    showDesc({}, updates);
    await userEvent.setup().click(screen.getByRole("button", { name: "Time" }));
    expect(header("Time")).toHaveAttribute("aria-sort", "ascending");
    expect(updates.mock.lastCall?.[0].searchParams.get("dir")).toBe("asc");
  });

  it("an unknown URL sort falls back to the default key in the default direction, and aria-sort matches", () => {
    showDesc({ sort: "bogus" });
    expect(header("Time")).toHaveAttribute("aria-sort", "descending");
    expect(header("User")).toHaveAttribute("aria-sort", "none");
    expect(
      screen
        .getByRole("button", { name: "Time" })
        .querySelector("svg")
        ?.getAttribute("class"),
    ).toMatch(/arrow-down/);
  });
});
