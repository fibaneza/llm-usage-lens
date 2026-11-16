"use client";

import { type ReactNode, useMemo, useState } from "react";
import {
  type Column,
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
import { FigureFormatProvider } from "@/components/table/figures";
import { CardSortControl } from "@/components/table/CardSortControl";
import { columnLabel } from "@/components/table/column-label";
import { ColumnToggle } from "@/components/table/ColumnToggle";
import { Pagination } from "@/components/table/Pagination";
import { SearchInput } from "@/components/table/SearchInput";
import { TableToolbar } from "@/components/table/TableToolbar";
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
import { cn } from "@/lib/utils";

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
  // Page filters (for example a model select) that join the search in the
  // toolbar's first slot.
  toolbarStart?: ReactNode;
  // Shown instead of the table and paging (a loading skeleton, a period with
  // no rows) while the toolbar stays mounted in the same place, so a page
  // filter in `toolbarStart` keeps keyboard focus across the transition.
  bodyOverride?: ReactNode;
};

type SortState = false | SortDirection;

function ariaSort(sorted: SortState) {
  if (sorted === "asc") return "ascending";
  if (sorted === "desc") return "descending";
  return "none";
}

function alignmentOf<T>(column: Column<T>) {
  const right = column.columnDef.meta?.align === "right";
  const numeric = column.columnDef.meta?.numeric === true;
  return {
    right,
    className: cn(right && "text-right", numeric && "font-mono tabular-nums"),
  };
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
// Responsive Tables). From md up the full table shows every column and fits its
// container: smaller type and tight cell padding below lg, wrapping headers and
// abbreviated figures
// (`FigureFormatProvider`); the cards keep the full figures.
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
  toolbarStart,
  bodyOverride,
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
      <TableToolbar
        start={
          <>
            {searchKey ? (
              <SearchInput
                value={search}
                placeholder={searchPlaceholder}
                onChange={(next) => {
                  setSearch(next);
                  table.setPageIndex(0);
                }}
              />
            ) : null}
            {toolbarStart}
          </>
        }
        end={
          <>
            {isMobile ? (
              <CardSortControl table={table} />
            ) : (
              <ColumnToggle
                columns={toggleableColumns}
                onToggle={(id, visible) =>
                  table.getColumn(id)?.toggleVisibility(visible)
                }
              />
            )}
            {toolbarActions?.({
              rows: table
                .getPrePaginationRowModel()
                .rows.map((row) => row.original),
              visibleColumnIds: table
                .getVisibleLeafColumns()
                .map((column) => column.id),
            })}
          </>
        }
      />

      {bodyOverride ? (
        bodyOverride
      ) : isMobile ? (
        rows.length > 0 ? (
          <UsageCardList table={table} caption={caption} />
        ) : null
      ) : (
        <FigureFormatProvider value="compact">
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
                    const align = alignmentOf(header.column);
                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          "px-1.5 whitespace-normal lg:px-3",
                          align.className,
                        )}
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
                            className={cn(
                              "focus-visible:ring-focus-ring focus-visible:ring-offset-background -mx-1 inline-flex flex-wrap items-center gap-x-1 rounded px-1 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2",
                              align.right && "flex-row-reverse",
                            )}
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
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "px-1.5 max-lg:text-xs lg:px-3",
                        alignmentOf(cell.column).className,
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FigureFormatProvider>
      )}

      {bodyOverride ? null : rows.length === 0 ? (
        (emptyState ?? <EmptyState title="No data to display" />)
      ) : (
        <Pagination
          pageIndex={table.getState().pagination.pageIndex}
          pageCount={table.getPageCount()}
          rowCount={table.getFilteredRowModel().rows.length}
          pageSize={table.getState().pagination.pageSize}
          onPageChange={(index) => table.setPageIndex(index)}
        />
      )}
    </div>
  );
}
