import type { Column } from "@tanstack/react-table";

export function columnLabel<T>(column: Column<T>): string {
  const { header } = column.columnDef;
  return typeof header === "string" ? header : column.id;
}
