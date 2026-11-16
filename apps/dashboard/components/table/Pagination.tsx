"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

type PaginationProps = {
  pageIndex: number;
  pageCount: number;
  rowCount: number;
  pageSize: number;
  onPageChange: (pageIndex: number) => void;
};

// Design System -- Component Inventory, `Pagination`. `pageIndex` is zero-based
// (TanStack Table); the visible text is one-based. The row range always shows;
// the page controls appear only from two pages (Table spec, 2026-11-16).
export function Pagination({
  pageIndex,
  pageCount,
  rowCount,
  pageSize,
  onPageChange,
}: PaginationProps) {
  const first = Math.min(pageIndex * pageSize + 1, rowCount);
  const last = Math.min((pageIndex + 1) * pageSize, rowCount);
  const range =
    rowCount === 0 ? "0 rows" : `${first}\u2013${last} of ${rowCount} rows`;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-2"
    >
      <span className="text-muted-foreground font-mono text-xs tabular-nums">
        {range}
      </span>
      {pageCount > 1 ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pageIndex <= 0}
            onClick={() => onPageChange(pageIndex - 1)}
          >
            <ChevronLeft aria-hidden />
            Previous
          </Button>
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            {`Page ${pageIndex + 1} of ${pageCount}`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onPageChange(pageIndex + 1)}
          >
            Next
            <ChevronRight aria-hidden />
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
