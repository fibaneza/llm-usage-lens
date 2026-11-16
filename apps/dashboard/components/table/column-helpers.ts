import type { ColumnDef, RowData } from "@tanstack/react-table";

declare module "@tanstack/react-table" {
  // The generics must match the library's declaration to merge.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right";
    // Numeric columns render in the mono face with tabular figures.
    numeric?: boolean;
  }
}

// Design System -- Table spec: numeric columns are right-aligned in the mono
// face, header included. One helper replaces the per-file NUMERIC constants.
export function numericColumn<T>(column: ColumnDef<T>): ColumnDef<T> {
  return { ...column, meta: { ...column.meta, align: "right", numeric: true } };
}
