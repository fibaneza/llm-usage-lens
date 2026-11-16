import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type TableToolbarProps = {
  start?: ReactNode;
  end?: ReactNode;
  className?: string;
};

// Design System -- Component Inventory, `TableToolbar`: one row above a table.
// Search and filters sit at the start, view controls (Columns, Export) at the
// end.
export function TableToolbar({ start, end, className }: TableToolbarProps) {
  return (
    <div
      data-slot="table-toolbar"
      className={cn(
        "flex min-h-8 flex-wrap items-center justify-between gap-2",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">{start}</div>
      <div className="flex flex-wrap items-center gap-2">{end}</div>
    </div>
  );
}
