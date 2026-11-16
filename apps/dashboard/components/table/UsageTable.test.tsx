import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UsageTable } from "./UsageTable";

// Implementation-phases Phase 4.2: "component tests for UsageTable (sort,
// filter, paginate)". Design System -- Component Inventory, `UsageTable`:
// sortable, filterable data table with pagination (TanStack Table + shadcn
// Table). A sortable header is a <button> inside a <th> carrying aria-sort;
// search is debounced 300 ms; pages hold 20 rows; ColumnToggle hides columns.
type Row = { id: string; name: string; cost: number; invocations: number };

const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name", enableHiding: false },
  { accessorKey: "cost", header: "Cost" },
  { accessorKey: "invocations", header: "Invocations" },
  { id: "note", header: "Note", enableSorting: false, cell: () => "n/a" },
];

const FEW: Row[] = [
  { id: "a", name: "Alpha", cost: 30, invocations: 111 },
  { id: "b", name: "Bravo", cost: 10, invocations: 333 },
  { id: "c", name: "Charlie", cost: 20, invocations: 222 },
];

// 30 "Alpha" rows then 15 "Beta" rows; cost rises with the index.
function manyRows(count = 45): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const label = String(n).padStart(2, "0");
    return {
      id: `r${n}`,
      name: n <= 30 ? `Alpha ${label}` : `Beta ${label}`,
      cost: n,
      invocations: n * 10,
    };
  });
}

type Props = Partial<Parameters<typeof UsageTable<Row>>[0]>;

function renderTable(data: Row[], props: Props = {}) {
  return render(
    <UsageTable<Row>
      data={data}
      columns={columns}
      getRowId={(row) => row.id}
      caption="Ranking"
      {...props}
    />,
  );
}

function table(): HTMLElement {
  return screen.getByRole("table", { name: "Ranking" });
}

function bodyRows(): HTMLElement[] {
  return Array.from(table().querySelectorAll<HTMLElement>("tbody tr"));
}

function bodyNames(): string[] {
  return bodyRows().map(
    (row) => row.querySelector("td")?.textContent?.trim() ?? "",
  );
}

const header = (name: RegExp) => screen.getByRole("columnheader", { name });
const sortButton = (name: RegExp) =>
  within(header(name)).getByRole("button", { name });
const nextPage = () => screen.getByRole("button", { name: /next/i });
const previousPage = () => screen.getByRole("button", { name: /previous/i });

afterEach(() => {
  vi.useRealTimers();
});

describe("UsageTable rendering", () => {
  it("renders a table named by its caption with a column header per column", () => {
    renderTable(FEW);

    expect(table()).toBeInTheDocument();
    for (const name of [/name/i, /cost/i, /invocations/i, /note/i]) {
      expect(header(name)).toBeInTheDocument();
    }
  });

  it("renders one row per record in the order given", () => {
    renderTable(FEW);

    expect(bodyNames()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(within(table()).getByText("333")).toBeInTheDocument();
  });
});

describe("UsageTable sorting", () => {
  it("marks sortable headers aria-sort none until one is sorted", () => {
    renderTable(FEW);

    for (const name of [/name/i, /cost/i, /invocations/i]) {
      expect(header(name)).toHaveAttribute("aria-sort", "none");
    }
  });

  it("gives non-sortable columns neither a sort button nor aria-sort", () => {
    renderTable(FEW);

    expect(
      within(header(/note/i)).queryByRole("button"),
    ).not.toBeInTheDocument();
    expect(header(/note/i)).not.toHaveAttribute("aria-sort");
  });

  it("sorts by a column when its header button is clicked, then reverses on a second click", async () => {
    const user = userEvent.setup();
    renderTable(FEW);
    const ascending = ["Bravo", "Charlie", "Alpha"];
    const descending = ["Alpha", "Charlie", "Bravo"];

    await user.click(sortButton(/cost/i));
    const first = header(/cost/i).getAttribute("aria-sort");
    expect(["ascending", "descending"]).toContain(first);
    expect(bodyNames()).toEqual(first === "ascending" ? ascending : descending);

    await user.click(sortButton(/cost/i));
    const second = header(/cost/i).getAttribute("aria-sort");
    expect(second).toBe(first === "ascending" ? "descending" : "ascending");
    expect(bodyNames()).toEqual(
      second === "ascending" ? ascending : descending,
    );
  });

  it("sorts text columns alphabetically", async () => {
    const user = userEvent.setup();
    renderTable([FEW[2], FEW[0], FEW[1]] as Row[]);

    await user.click(sortButton(/name/i));
    const direction = header(/name/i).getAttribute("aria-sort");

    expect(bodyNames()).toEqual(
      direction === "ascending"
        ? ["Alpha", "Bravo", "Charlie"]
        : ["Charlie", "Bravo", "Alpha"],
    );
  });

  it("returns the previously sorted column to none when another is sorted", async () => {
    const user = userEvent.setup();
    renderTable(FEW);

    await user.click(sortButton(/cost/i));
    await user.click(sortButton(/invocations/i));

    expect(header(/cost/i)).toHaveAttribute("aria-sort", "none");
    expect(header(/invocations/i).getAttribute("aria-sort")).not.toBe("none");
  });

  it("starts sorted by initialSort", () => {
    renderTable(FEW, { initialSort: { id: "cost", desc: true } });

    expect(header(/cost/i)).toHaveAttribute("aria-sort", "descending");
    expect(bodyNames()).toEqual(["Alpha", "Charlie", "Bravo"]);
  });

  it("sorts the whole data set before paging, not just the visible page", async () => {
    const user = userEvent.setup();
    renderTable(manyRows(), { initialSort: { id: "cost", desc: true } });

    expect(bodyNames()[0]).toBe("Beta 45");
    expect(bodyNames()).toHaveLength(20);

    await user.click(nextPage());
    await user.click(nextPage());

    expect(bodyNames()).toEqual([
      "Alpha 05",
      "Alpha 04",
      "Alpha 03",
      "Alpha 02",
      "Alpha 01",
    ]);
  });
});

describe("UsageTable pagination", () => {
  it("shows 20 rows per page by default with 'Page 1 of 3' for 45 rows", () => {
    renderTable(manyRows());

    expect(bodyRows()).toHaveLength(20);
    expect(bodyNames()[0]).toBe("Alpha 01");
    expect(bodyNames()[19]).toBe("Alpha 20");
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Pagination" }),
    ).toBeInTheDocument();
  });

  it("disables Previous on the first page and Next on the last", async () => {
    const user = userEvent.setup();
    renderTable(manyRows());

    expect(previousPage()).toBeDisabled();
    expect(nextPage()).toBeEnabled();

    await user.click(nextPage());
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(previousPage()).toBeEnabled();
    expect(nextPage()).toBeEnabled();

    await user.click(nextPage());
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(5);
    expect(bodyNames()[0]).toBe("Beta 41");
    expect(nextPage()).toBeDisabled();
    expect(previousPage()).toBeEnabled();
  });

  it("goes back a page when Previous is clicked", async () => {
    const user = userEvent.setup();
    renderTable(manyRows());

    await user.click(nextPage());
    expect(bodyNames()[0]).toBe("Alpha 21");
    await user.click(previousPage());

    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(bodyNames()[0]).toBe("Alpha 01");
  });

  it("fits exactly 20 rows on a single page and spills row 21 onto a second", () => {
    const { unmount } = renderTable(manyRows(20));
    expect(screen.queryByText(/Page 1 of 1/)).not.toBeInTheDocument();
    expect(bodyRows()).toHaveLength(20);
    expect(
      screen.queryByRole("button", { name: /next/i }),
    ).not.toBeInTheDocument();
    unmount();

    renderTable(manyRows(21));
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(20);
  });

  it("honours a custom pageSize", () => {
    renderTable(manyRows(12), { pageSize: 5 });

    expect(bodyRows()).toHaveLength(5);
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });
});

describe("UsageTable search", () => {
  const SEARCH = { searchKey: "name", searchPlaceholder: "Search by name" };

  function search(value: string) {
    fireEvent.change(screen.getByPlaceholderText("Search by name"), {
      target: { value },
    });
  }

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("renders a search input only when a searchKey is given", () => {
    const { unmount } = renderTable(FEW, SEARCH);
    expect(screen.getByPlaceholderText("Search by name")).toBeInTheDocument();
    unmount();

    renderTable(FEW);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("filters rows by the search key after the 300 ms debounce, ignoring case", () => {
    vi.useFakeTimers();
    renderTable(FEW, SEARCH);

    search("bRAv");

    advance(299);
    expect(bodyNames()).toEqual(["Alpha", "Bravo", "Charlie"]);
    advance(1);
    expect(bodyNames()).toEqual(["Bravo"]);
  });

  it("shows all rows again when the search is cleared", () => {
    vi.useFakeTimers();
    renderTable(FEW, SEARCH);

    search("bravo");
    advance(300);
    expect(bodyNames()).toEqual(["Bravo"]);

    search("");
    advance(300);
    expect(bodyNames()).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("returns to page 1 when a search is applied", () => {
    vi.useFakeTimers();
    renderTable(manyRows(), SEARCH);

    fireEvent.click(nextPage());
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();

    search("alpha");
    advance(300);

    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(20);
    expect(bodyNames()[0]).toBe("Alpha 01");
  });

  it("filters before sorting and paging", () => {
    vi.useFakeTimers();
    renderTable(manyRows(), {
      ...SEARCH,
      initialSort: { id: "cost", desc: true },
    });

    search("beta");
    advance(300);

    expect(screen.queryByText(/Page 1 of 1/)).not.toBeInTheDocument();
    expect(screen.getByText(/15 rows/)).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(15);
    expect(bodyNames()[0]).toBe("Beta 45");
  });

  it("keeps the search input available when nothing matches so it can be cleared", () => {
    vi.useFakeTimers();
    renderTable(FEW, {
      ...SEARCH,
      emptyState: <p>No matching rows</p>,
    });

    search("zzz");
    advance(300);

    expect(screen.getByText("No matching rows")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(0);
    expect(screen.getByPlaceholderText("Search by name")).toBeInTheDocument();
  });
});

describe("UsageTable column toggle", () => {
  async function openColumns(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Columns" }));
  }

  it("lists a checkbox item for each hideable column only", async () => {
    const user = userEvent.setup();
    renderTable(FEW);

    await openColumns(user);

    const items = await screen.findAllByRole("menuitemcheckbox");
    expect(items.map((el) => el.textContent?.trim())).toEqual([
      "Cost",
      "Invocations",
      "Note",
    ]);
    expect(
      items.every((el) => el.getAttribute("aria-checked") === "true"),
    ).toBe(true);
  });

  it("hides a column and its cells, then shows them again", async () => {
    const user = userEvent.setup();
    renderTable(FEW);

    await openColumns(user);
    await user.click(
      await screen.findByRole("menuitemcheckbox", { name: "Invocations" }),
    );

    expect(
      screen.queryByRole("columnheader", { name: /invocations/i }),
    ).not.toBeInTheDocument();
    expect(within(table()).queryByText("111")).not.toBeInTheDocument();
    expect(header(/cost/i)).toBeInTheDocument();

    await openColumns(user);
    const item = await screen.findByRole("menuitemcheckbox", {
      name: "Invocations",
    });
    expect(item).toHaveAttribute("aria-checked", "false");
    await user.click(item);

    expect(header(/invocations/i)).toBeInTheDocument();
    expect(within(table()).getByText("111")).toBeInTheDocument();
  });
});

describe("UsageTable empty state", () => {
  it("renders the supplied emptyState when there are no rows", () => {
    renderTable([], { emptyState: <p>No usage in this period</p> });

    expect(screen.getByText("No usage in this period")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(0);
  });

  it("falls back to the EmptyState component when no emptyState is given", () => {
    renderTable([]);

    expect(screen.getByText(/^no (data|results|rows)/i)).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(0);
  });

  it("does not render the empty state when there are rows", () => {
    renderTable(FEW, { emptyState: <p>No usage in this period</p> });

    expect(
      screen.queryByText("No usage in this period"),
    ).not.toBeInTheDocument();
  });
});

// Shared by the toolbar-slot and card-layout suites below.
function commonAncestor(a: Element, b: Element): Element | null {
  let node: Element | null = a;
  while (node && !node.contains(b)) node = node.parentElement;
  return node;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

// Design System -- Component Inventory, `UsageTable` / `ExportButton`: the
// export reads the table's current rows and columns, which UsageTable keeps
// internal, so it exposes an additive `toolbarActions` render-prop rendered in
// the toolbar beside ColumnToggle. `rows` are the filtered and sorted records
// across all pages; `visibleColumnIds` follows ColumnToggle.
describe("UsageTable toolbarActions slot", () => {
  function actions(view: { rows: Row[]; visibleColumnIds: string[] }) {
    return (
      <div data-testid="actions">
        <span data-testid="action-rows">
          {view.rows.map((row) => row.name).join("|")}
        </span>
        <span data-testid="action-count">{view.rows.length}</span>
        <span data-testid="action-columns">
          {view.visibleColumnIds.join("|")}
        </span>
      </div>
    );
  }

  const actionRows = () => screen.getByTestId("action-rows").textContent;
  const actionCount = () => screen.getByTestId("action-count").textContent;
  const actionColumns = () => screen.getByTestId("action-columns").textContent;

  it("renders the slot's output in the toolbar beside the Columns button, above the table", () => {
    renderTable(FEW, { toolbarActions: actions });

    const slot = screen.getByTestId("actions");
    const columns = screen.getByRole("button", { name: "Columns" });
    const toolbar = commonAncestor(slot, columns);
    expect(toolbar).not.toBeNull();
    expect(toolbar?.contains(table())).toBe(false);
    expect(table().contains(slot)).toBe(false);
    expect(
      slot.compareDocumentPosition(table()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("passes the original records, sorted, to the slot", () => {
    renderTable(FEW, {
      toolbarActions: actions,
      initialSort: { id: "cost", desc: true },
    });

    expect(actionRows()).toBe("Alpha|Charlie|Bravo");
  });

  it("passes every filtered and sorted row across all pages, not just the current page", async () => {
    const user = userEvent.setup();
    renderTable(manyRows(), {
      toolbarActions: actions,
      initialSort: { id: "cost", desc: true },
    });

    expect(bodyRows()).toHaveLength(20);
    expect(actionCount()).toBe("45");
    expect(actionRows()?.startsWith("Beta 45|Beta 44|")).toBe(true);
    expect(actionRows()?.endsWith("|Alpha 02|Alpha 01")).toBe(true);

    await user.click(nextPage());
    expect(bodyRows()).toHaveLength(20);
    expect(actionCount()).toBe("45");
  });

  it("follows the search filter", () => {
    vi.useFakeTimers();
    renderTable(manyRows(), {
      toolbarActions: actions,
      searchKey: "name",
      searchPlaceholder: "Search by name",
    });

    fireEvent.change(screen.getByPlaceholderText("Search by name"), {
      target: { value: "beta" },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(actionCount()).toBe("15");
    expect(
      actionRows()
        ?.split("|")
        .every((name) => name.startsWith("Beta")),
    ).toBe(true);
  });

  it("is still rendered, with no rows, when the search matches nothing", () => {
    vi.useFakeTimers();
    renderTable(FEW, {
      toolbarActions: actions,
      searchKey: "name",
      searchPlaceholder: "Search by name",
    });

    fireEvent.change(screen.getByPlaceholderText("Search by name"), {
      target: { value: "zzz" },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(actionCount()).toBe("0");
    expect(actionRows()).toBe("");
  });

  it("follows the sort order when a header is clicked", async () => {
    const user = userEvent.setup();
    renderTable(FEW, { toolbarActions: actions });
    expect(actionRows()).toBe("Alpha|Bravo|Charlie");

    await user.click(sortButton(/invocations/i));

    const direction = header(/invocations/i).getAttribute("aria-sort");
    expect(actionRows()).toBe(
      direction === "ascending" ? "Alpha|Charlie|Bravo" : "Bravo|Charlie|Alpha",
    );
  });

  it("lists the visible column ids in display order and follows ColumnToggle", async () => {
    const user = userEvent.setup();
    renderTable(FEW, { toolbarActions: actions });
    expect(actionColumns()).toBe("name|cost|invocations|note");

    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(
      await screen.findByRole("menuitemcheckbox", { name: "Invocations" }),
    );
    expect(actionColumns()).toBe("name|cost|note");

    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(
      await screen.findByRole("menuitemcheckbox", { name: "Invocations" }),
    );
    expect(actionColumns()).toBe("name|cost|invocations|note");
  });

  it("adds nothing to the toolbar when the prop is omitted", () => {
    renderTable(FEW);

    expect(screen.queryByTestId("actions")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /export/i }),
    ).not.toBeInTheDocument();
  });
});

// Design System -- Table spec (2026-11-16): row count always shown; numeric
// columns right-aligned in the mono face with tabular figures, header aligned
// with its column; the toolbar is one row that page filters join.
describe("UsageTable compact additions", () => {
  it("always shows the visible row range and total, and the controls from two pages", () => {
    renderTable(manyRows(45));

    expect(screen.getByText("1\u201320 of 45 rows")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });

  it("right-aligns columns marked meta.align right in the mono face, header included", () => {
    const numeric: ColumnDef<Row>[] = [
      { accessorKey: "name", header: "Name", enableHiding: false },
      {
        accessorKey: "cost",
        header: "Cost",
        meta: { align: "right", numeric: true },
      },
    ];
    renderTable(FEW, { columns: numeric });

    for (const el of [
      header(/cost/i),
      screen.getAllByRole("cell", { name: "30" })[0] as HTMLElement,
    ]) {
      expect(el).toHaveClass("text-right", "font-mono", "tabular-nums");
    }
    expect(header(/name/i)).not.toHaveClass("text-right");
    expect(screen.getByRole("cell", { name: "Alpha" })).not.toHaveClass(
      "font-mono",
    );
  });

  it("renders toolbarStart in the same toolbar row as Columns and the search", () => {
    const { container } = renderTable(FEW, {
      searchKey: "name",
      searchPlaceholder: "Search by name",
      toolbarStart: <button type="button">Model filter</button>,
    });

    const toolbar = container.querySelector('[data-slot="table-toolbar"]');
    expect(toolbar).not.toBeNull();
    for (const el of [
      screen.getByRole("button", { name: "Model filter" }),
      screen.getByRole("button", { name: "Columns" }),
      screen.getByPlaceholderText("Search by name"),
    ]) {
      expect(toolbar?.contains(el)).toBe(true);
    }
  });
});

describe("UsageTable root", () => {
  it('is marked data-slot="usage-table" and contains the toolbar and the table', () => {
    const { container } = renderTable(FEW);

    const root = container.querySelector('[data-slot="usage-table"]');
    expect(root).not.toBeNull();
    expect(root?.contains(table())).toBe(true);
    expect(
      root?.contains(screen.getByRole("button", { name: "Columns" })),
    ).toBe(true);
  });
});

// Design System -- Responsive Tables: below `md` (768px) each row collapses
// into a card -- the entity name is the title, Cost is prominent, the other
// metrics are label-value pairs -- driven by the same data, sorting and
// pagination; SearchInput and Pagination stay available (ColumnToggle is hidden
// in card-list mode, Table spec 2026-11-16); no
// horizontal scroll. The `name` and `cost` columns (the ids used by every
// dashboard table) are the card title and the prominent figure. The card list
// is a `list` named by the caption. useIsMobile reads window.innerWidth.
describe("UsageTable mobile card layout (viewport below 768px)", () => {
  const originalWidth = window.innerWidth;
  const SEARCH = { searchKey: "name", searchPlaceholder: "Search by name" };

  // Cost renders through its own cell so the cards must reuse column cells.
  const moneyColumns: ColumnDef<Row>[] = columns.map((column) =>
    "accessorKey" in column && column.accessorKey === "cost"
      ? {
          ...column,
          cell: ({ row }) => `$${row.original.cost}.00`,
        }
      : column,
  );

  beforeEach(() => {
    setViewportWidth(375);
  });

  afterEach(() => {
    setViewportWidth(originalWidth);
  });

  const cardList = () => screen.getByRole("list", { name: "Ranking" });
  const cards = () => within(cardList()).getAllByRole("listitem");
  const cardText = (card: HTMLElement) =>
    (card.textContent ?? "").replace(/\s+/g, " ").trim();
  const cardNames = () =>
    cards().map(
      (card) =>
        /^(Alpha|Beta|Bravo|Charlie)(?: \d{2})?/.exec(cardText(card))?.[0] ??
        "?",
    );

  async function chooseSort(
    user: ReturnType<typeof userEvent.setup>,
    label: string,
  ) {
    const control = screen.getByRole("combobox", { name: /sort/i });
    if (control instanceof HTMLSelectElement) {
      await user.selectOptions(control, label);
    } else {
      await user.click(control);
      await user.click(await screen.findByRole("option", { name: label }));
    }
  }

  it("renders a named list of cards, one per row in the order given, and no table", () => {
    renderTable(FEW);

    expect(cardNames()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);
  });

  it("leads each card with the name as its title, then the cost, then the other metrics as label-value pairs", () => {
    renderTable(FEW);

    const text = cardText(cards()[0] as HTMLElement);
    expect(text.startsWith("Alpha")).toBe(true);
    expect(text).toMatch(/Invocations\W*111/);
    expect(text).toMatch(/Note\W*n\/a/);
    expect(text).not.toMatch(/\bName\b/);
    expect(text.indexOf("30")).toBeGreaterThan(text.indexOf("Alpha"));
    expect(text.indexOf("30")).toBeLessThan(text.indexOf("Invocations"));
  });

  it("reuses the column cell renderers inside the cards", () => {
    renderTable(FEW, { columns: moneyColumns });

    const text = cardText(cards()[1] as HTMLElement);
    expect(text.startsWith("Bravo")).toBe(true);
    expect(text).toContain("$10.00");
    expect(text).toMatch(/Invocations\W*333/);
  });

  it("starts in the initialSort order", () => {
    renderTable(FEW, { initialSort: { id: "cost", desc: true } });

    expect(cardNames()).toEqual(["Alpha", "Charlie", "Bravo"]);
  });

  it("sorts the cards by a sortable column chosen in a Sort control, and can reverse", async () => {
    const user = userEvent.setup();
    renderTable(FEW);
    const ascending = ["Alpha", "Charlie", "Bravo"];
    const descending = ["Bravo", "Charlie", "Alpha"];

    await chooseSort(user, "Invocations");
    const first = cardNames();
    expect([ascending, descending]).toContainEqual(first);

    const reverse = screen.getByRole("button", {
      name: /ascending|descending/i,
    });
    await user.click(reverse);
    expect(cardNames()).toEqual(
      first.join() === ascending.join() ? descending : ascending,
    );
  });

  it("offers only the sortable columns in the Sort control", async () => {
    const user = userEvent.setup();
    renderTable(FEW);

    const control = screen.getByRole("combobox", { name: /sort/i });
    if (!(control instanceof HTMLSelectElement)) await user.click(control);

    const options = (
      control instanceof HTMLSelectElement
        ? within(control).getAllByRole("option")
        : await screen.findAllByRole("option")
    ).map((option) => option.textContent?.trim());
    expect(options).toEqual(
      expect.arrayContaining(["Name", "Cost", "Invocations"]),
    );
    expect(options).not.toContain("Note");
  });

  it("sorts and pages the whole data set: 20 cards a page, Page 1 of 3", async () => {
    const user = userEvent.setup();
    renderTable(manyRows(), { initialSort: { id: "cost", desc: true } });

    expect(cards()).toHaveLength(20);
    expect(cardNames()[0]).toBe("Beta 45");
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(previousPage()).toBeDisabled();

    await user.click(nextPage());
    await user.click(nextPage());

    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(cardNames()).toEqual([
      "Alpha 05",
      "Alpha 04",
      "Alpha 03",
      "Alpha 02",
      "Alpha 01",
    ]);
    expect(nextPage()).toBeDisabled();
  });

  it("filters the cards by the search key after the 300 ms debounce and returns to page 1", () => {
    vi.useFakeTimers();
    renderTable(manyRows(), SEARCH);

    fireEvent.click(nextPage());
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search by name"), {
      target: { value: "beta" },
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(cards()).toHaveLength(20);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(cards()).toHaveLength(15);
    expect(screen.queryByText(/Page 1 of 1/)).not.toBeInTheDocument();
    expect(screen.getByText(/15 rows/)).toBeInTheDocument();
    expect(cardNames()[0]).toBe("Beta 31");
  });

  // Table spec (2026-11-16): the Columns toggle is hidden in card-list mode;
  // the column set still drives the card fields, so every visible column shows.
  it("does not offer the Columns toggle in card-list mode and shows every column's pair", () => {
    renderTable(FEW);

    expect(
      screen.queryByRole("button", { name: "Columns" }),
    ).not.toBeInTheDocument();
    const text = cardText(cards()[0] as HTMLElement);
    expect(text).toMatch(/Invocations/);
    expect(text.startsWith("Alpha")).toBe(true);
  });

  // Table spec (2026-11-16): the card title is the non-hideable column, even
  // when its id is not `name` or it renders a link (Teams cards).
  it("titles each card with the non-hideable column even when its id is not name", () => {
    const teamColumns: ColumnDef<Row>[] = [
      {
        id: "team",
        header: "Team",
        enableHiding: false,
        cell: ({ row }) => (
          <a href={`/t/${row.original.id}`}>{row.original.name}</a>
        ),
      },
      { accessorKey: "cost", header: "Cost" },
      { accessorKey: "invocations", header: "Invocations" },
    ];
    renderTable(FEW, { columns: teamColumns });

    const first = cards()[0] as HTMLElement;
    expect(cardText(first).startsWith("Alpha")).toBe(true);
    expect(
      within(first).getByRole("link", { name: "Alpha" }),
    ).toBeInTheDocument();
    const labels = Array.from(first.querySelectorAll("dt")).map((dt) =>
      dt.textContent?.trim(),
    );
    expect(labels).not.toContain("Team");
    expect(labels).toContain("Invocations");
  });

  it("renders the emptyState instead of cards when there are no rows", () => {
    renderTable([], { emptyState: <p>No usage in this period</p> });

    expect(screen.getByText("No usage in this period")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("still renders the toolbarActions slot, with the same rows and visible columns", () => {
    renderTable(FEW, {
      initialSort: { id: "cost", desc: true },
      toolbarActions: ({ rows, visibleColumnIds }) => (
        <span data-testid="actions">
          {rows.map((row) => row.name).join("|")}/{visibleColumnIds.join("|")}
        </span>
      ),
    });

    expect(screen.getByTestId("actions")).toHaveTextContent(
      "Alpha|Charlie|Bravo/name|cost|invocations|note",
    );
    expect(
      screen.getByTestId("actions").compareDocumentPosition(cardList()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps the data-slot="usage-table" root', () => {
    const { container } = renderTable(FEW);

    const root = container.querySelector('[data-slot="usage-table"]');
    expect(root).not.toBeNull();
    expect(root?.contains(cardList())).toBe(true);
  });

  it("switches at the md boundary: 767px is cards, 768px and up is the table", () => {
    setViewportWidth(767);
    const narrow = renderTable(FEW);
    expect(cardList()).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    narrow.unmount();

    for (const width of [768, 1024, 1440]) {
      setViewportWidth(width);
      const wide = renderTable(FEW);
      expect(table()).toBeInTheDocument();
      expect(
        screen.queryByRole("list", { name: "Ranking" }),
      ).not.toBeInTheDocument();
      expect(header(/cost/i)).toBeInTheDocument();
      wide.unmount();
    }
  });
});
