import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
};

// Design System -- Component Inventory, `EmptyState`: a reusable empty state
// with icon, message and optional call to action.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      {Icon ? (
        <Icon className="text-muted-foreground size-8" aria-hidden />
      ) : null}
      <p className="text-foreground text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
      {action}
    </div>
  );
}
