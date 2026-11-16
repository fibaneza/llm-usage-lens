import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type KeyValueItem = {
  term: string;
  value: ReactNode;
  // Monospace for IDs and numbers.
  mono?: boolean;
};

type KeyValueListProps = {
  items: readonly KeyValueItem[];
  columns?: 1 | 2;
};

// Design System -- Layout, Key-value lists: a `<dl>` with a muted 13px term
// column and 13px values on 32px rows.
export function KeyValueList({ items, columns = 1 }: KeyValueListProps) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[minmax(5rem,min(12rem,45%))_minmax(0,1fr)] items-center gap-x-4",
        columns === 2 &&
          "lg:grid-cols-[minmax(5rem,min(12rem,22%))_minmax(0,1fr)_minmax(5rem,min(12rem,22%))_minmax(0,1fr)]",
      )}
    >
      {items.map((item) => (
        <div
          key={item.term}
          className="col-span-2 grid min-w-0 grid-cols-subgrid"
        >
          <dt className="text-cell text-muted-foreground flex min-h-8 items-center">
            {item.term}
          </dt>
          <dd
            className={cn(
              "text-cell flex min-h-8 min-w-0 items-center break-words",
              item.mono && "font-mono tabular-nums",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
