"use client";

import type { Table } from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";

import { columnLabel } from "@/components/table/column-label";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

type CardSortControlProps<T> = {
  table: Table<T>;
};

// Design System -- Responsive Tables: the card layout has no column headers to
// click, so sorting moves to a native select over the sortable columns plus a
// direction toggle, driving the same TanStack sorting state as the headers.
export function CardSortControl<T>({ table }: CardSortControlProps<T>) {
  const sortable = table.getAllLeafColumns().filter((c) => c.getCanSort());
  const active = table.getState().sorting[0];

  return (
    <div className="flex items-center gap-1">
      <NativeSelect
        aria-label="Sort by"
        value={active?.id ?? ""}
        onChange={(event) => {
          const column = table.getColumn(event.target.value);
          table.setSorting(
            column
              ? [{ id: column.id, desc: column.getFirstSortDir() === "desc" }]
              : [],
          );
        }}
        className="max-w-40"
      >
        <option value="">Default order</option>
        {sortable.map((column) => (
          <option key={column.id} value={column.id}>
            {columnLabel(column)}
          </option>
        ))}
      </NativeSelect>
      {active ? (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={
            active.desc
              ? "Sorted descending, switch to ascending"
              : "Sorted ascending, switch to descending"
          }
          onClick={() =>
            table.setSorting([{ id: active.id, desc: !active.desc }])
          }
        >
          {active.desc ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden />}
        </Button>
      ) : null}
    </div>
  );
}
