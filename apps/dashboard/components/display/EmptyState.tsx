import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  // `sm` is a one-line empty inside a table or Panel (Design System -- States).
  size?: "default" | "sm";
};

// Design System -- Component Inventory, `EmptyState`: a reusable empty state
// with icon, message and optional call to action.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "default",
}: EmptyStateProps) {
  const compact = size === "sm";

  return (
    <div
      className={cn(
        "flex gap-2",
        compact
          ? "min-h-12 flex-row flex-wrap items-center px-4 py-3"
          : "flex-col items-center justify-center px-4 py-10 text-center",
      )}
    >
      {Icon ? (
        <Icon
          className={cn(
            "text-muted-foreground shrink-0",
            compact ? "size-4" : "size-8",
          )}
          aria-hidden
        />
      ) : null}
      <p className="text-foreground text-sm font-semibold">{title}</p>
      {description ? (
        <p className="text-muted-foreground text-cell max-w-[72ch]">
          {description}
        </p>
      ) : null}
      {action}
    </div>
  );
}
