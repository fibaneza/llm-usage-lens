"use client";

import { type Cell, flexRender, type Table } from "@tanstack/react-table";

import { columnLabel } from "@/components/table/column-label";

type UsageCardListProps<T> = {
  table: Table<T>;
  caption: string;
};

function CellContent<T>({ cell }: { cell: Cell<T, unknown> }) {
  return flexRender(cell.column.columnDef.cell, cell.getContext());
}

// Design System -- Responsive Tables: below md each row is a card -- the
// non-hideable cell (the entity name or link) is the title, the `cost` cell the prominent figure, every other
// visible column a label-value pair. The cells are the column definitions' own,
// so the cards show exactly what the table would.
export function UsageCardList<T>({ table, caption }: UsageCardListProps<T>) {
  return (
    <ul role="list" aria-label={caption} className="space-y-3">
      {table.getRowModel().rows.map((row) => {
        const cells = row.getVisibleCells();
        const title =
          cells.find((cell) => !cell.column.getCanHide()) ??
          cells.find((cell) => cell.column.id === "name");
        const cost = cells.find((cell) => cell.column.id === "cost");
        const rest = cells.filter((cell) => cell !== title && cell !== cost);

        return (
          <li
            key={row.id}
            className="bg-card text-card-foreground rounded-card space-y-3 border p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 font-medium break-words">
                {title ? <CellContent cell={title} /> : null}
              </div>
              {cost ? (
                <div className="shrink-0 text-base font-semibold">
                  <span className="sr-only">{columnLabel(cost.column)}</span>
                  <CellContent cell={cost} />
                </div>
              ) : null}
            </div>
            {rest.length > 0 ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {rest.map((cell) => (
                  <div key={cell.id} className="min-w-0">
                    <dt className="text-muted-foreground text-xs">
                      {columnLabel(cell.column)}
                    </dt>
                    <dd className="break-words">
                      <CellContent cell={cell} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
