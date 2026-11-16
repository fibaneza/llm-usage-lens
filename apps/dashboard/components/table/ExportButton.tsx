"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { type CsvColumn, toCsv } from "@/lib/csv";

type ExportButtonProps<T> = {
  filename: string;
  columns: CsvColumn<T>[];
  rows: T[];
  disabled?: boolean;
};

// Design System -- Component Inventory, `ExportButton`: export table data to
// CSV. The file is built in the browser from the rows the table is showing.
export function ExportButton<T>({
  filename,
  columns,
  rows,
  disabled = false,
}: ExportButtonProps<T>) {
  function download() {
    const blob = new Blob([toCsv(columns, rows)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={download}
      disabled={disabled}
    >
      <Download aria-hidden />
      Export CSV
    </Button>
  );
}
