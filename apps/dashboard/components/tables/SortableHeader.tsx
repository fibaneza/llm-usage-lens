"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import type { ReactNode } from "react";

import { TableHead } from "@/components/ui/table";

// Design System - "The users table (unit US1; D-US4)": a button inside the th,
// aria-sort on the th, the sort in the URL (`sort`, `dir`); the arrow is not
// the only signal. `defaultKey` is sorted ascending while the URL has no sort.
export const SORT_PARAMS = {
  sort: parseAsString,
  dir: parseAsString,
};

export function readSort(
  sort: string | null,
  dir: string | null,
  defaultKey: string,
  allowed?: readonly string[],
): { key: string; dir: "asc" | "desc" } {
  const known = sort !== null && (!allowed || allowed.includes(sort));
  return {
    key: known ? sort : defaultKey,
    dir: known && dir === "desc" ? "desc" : "asc",
  };
}

export function SortableHeader({
  sortKey,
  sortKeys,
  defaultKey,
  children,
}: {
  sortKey: string;
  sortKeys: readonly string[];
  defaultKey?: string;
  children: ReactNode;
}) {
  const [params, setParams] = useQueryStates(SORT_PARAMS);
  const current = readSort(params.sort, params.dir, defaultKey ?? "", sortKeys);
  const active = current.key === sortKey;
  const Arrow = !active
    ? ArrowUpDown
    : current.dir === "asc"
      ? ArrowUp
      : ArrowDown;

  return (
    <TableHead
      aria-sort={
        active ? (current.dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        className="focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
        onClick={() =>
          void setParams({
            sort: sortKey,
            dir: active && current.dir === "asc" ? "desc" : "asc",
          })
        }
      >
        {children}
        <Arrow
          aria-hidden="true"
          className={active ? "size-3.5" : "text-muted-foreground size-3.5"}
        />
      </button>
    </TableHead>
  );
}
