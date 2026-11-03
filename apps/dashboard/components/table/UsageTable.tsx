"use client";

import { type ReactNode, useMemo, useState } from "react";
import {
  type ColumnDef,
  type ColumnSort,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortDirection,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { EmptyState } from "@/components/display/EmptyState";
import { CardSortControl } from "@/components/table/CardSortControl";
import { columnLabel } from "@/components/table/column-label";
import { ColumnToggle } from "@/components/table/ColumnToggle";
import { Pagination } from "@/components/table/Pagination";
import { SearchInput } from "@/components/table/SearchInput";
import { UsageCardList } from "@/components/table/UsageCardList";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";

type ToolbarView<T> = {
  rows: T[];
  visibleColumnIds: string[];
};

type UsageTableProps<T> = {
  data: T[];
  columns: ColumnDef<T>[];
  getRowId: (row: T) => string;
  initialSort?: ColumnSort;
  searchKey?: string;
  searchPlaceholder?: string;
  pageSize?: number;
  caption: string;
  emptyState?: ReactNode;
  toolbarActions?: (view: ToolbarView<T>) => ReactNode;
};

type SortState = false | SortDirection;

function ariaSort(sorted: SortState) {
  if (sorted === "asc") return "ascending";
  if (sorted === "desc") return "descending";
  return "none";
}

function SortIcon({ sorted }: { sorted: SortState }) {
  if (sorted === "asc") return <ArrowUp className="size-3.5" aria-hidden />;
  if (sorted === "desc") return <ArrowDown className="size-3.5" aria-hidden />;
  return <ArrowUpDown className="text-muted-foreground size-3.5" aria-hidden />;
}

// Design System -- Component Inventory, `UsageTable`: a sortable, filterable
// data table with pagination (TanStack Table + shadcn Table). Search filters
// first, then sort, then paging, so every page reflects the whole data set.
// `toolbarActions` renders beside ColumnToggle with the filtered and sorted rows
// (all pages) and visible column ids, e.g. for an export. Below md (768px) the
// rows collapse into cards driven by the same table state (Design System --
// Responsive Tables).
export function UsageTable<T>({
  data,
  columns,
  getRowId,
  initialSort,
  searchKey,
  searchPlaceholder,
  pageSize = 20,
  caption,
  emptyState,
  toolbarActions,
}: UsageTableProps<T>) {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const columnFilters = useMemo(
    () => (searchKey && search ? [{ id: searchKey, value: search }] : []),
    [searchKey, search],
  );

  // TanStack Table's hook returns unmemoizable functions; React Compiler skips
  // this component, which is the documented, safe outcome.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getRowId,
    initialState: {
      sorting: initialSort ? [initialSort] : [],
      pagination: { pageIndex: 0, pageSize },
    },
    state: { columnFilters },
    defaultColumn: { filterFn: "includesString" },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const rows = table.getRowModel().rows;
  const toggleableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide())
    .map((column) => ({
      id: column.id,
      label: columnLabel(column),
      visible: column.getIsVisible(),
    }));

  return (
    <div data-slot="usage-table" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {searchKey ? (
          <SearchInput
            value={search}
            placeholder={searchPlaceholder}
            onChange={(next) => {
              setSearch(next);
              table.setPageIndex(0);
            }}
          />
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {isMobile ? <CardSortControl table={table} /> : null}
          <ColumnToggle
            columns={toggleableColumns}
            onToggle={(id, visible) =>
              table.getColumn(id)?.toggleVisibility(visible)
            }
          />
          {toolbarActions?.({
            rows: table
              .getPrePaginationRowModel()
              .rows.map((row) => row.original),
            visibleColumnIds: table
              .getVisibleLeafColumns()
              .map((column) => column.id),
          })}
        </div>
      </div>

      {isMobile ? (
        rows.length > 0 ? (
          <UsageCardList table={table} caption={caption} />
        ) : null
      ) : (
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const content = header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      );
                  const sortable = header.column.getCanSort();
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        sortable
                          ? ariaSort(header.column.getIsSorted())
                          : undefined
                      }
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="focus-visible:ring-ring/50 -mx-1 inline-flex items-center gap-1 rounded px-1 outline-none focus-visible:ring-[3px]"
                        >
                          {content}
                          <SortIcon sorted={header.column.getIsSorted()} />
                        </button>
                      ) : (
                        content
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {rows.length === 0 ? (
        (emptyState ?? <EmptyState title="No data to display" />)
      ) : (
        <Pagination
          pageIndex={table.getState().pagination.pageIndex}
          pageCount={table.getPageCount()}
          onPageChange={(index) => table.setPageIndex(index)}
        />
      )}
    </div>
  );
}
