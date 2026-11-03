"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

type PaginationProps = {
  pageIndex: number;
  pageCount: number;
  onPageChange: (pageIndex: number) => void;
};

// Design System -- Component Inventory, `Pagination`. `pageIndex` is zero-based
// (TanStack Table); the visible text is one-based.
export function Pagination({
  pageIndex,
  pageCount,
  onPageChange,
}: PaginationProps) {
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-end gap-2"
    >
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
      <span className="text-muted-foreground font-mono text-sm tabular-nums">
        {`Page ${pageIndex + 1} of ${Math.max(pageCount, 1)}`}
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
    </nav>
  );
}
