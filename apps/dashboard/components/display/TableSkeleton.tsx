import { Skeleton } from "@/components/ui/skeleton";

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-px">
      <Skeleton className="h-row-head w-full" />
      {Array.from({ length: rows }, (_, slot) => `row-${slot + 1}`).map(
        (key) => (
          <Skeleton key={key} className="h-row w-full" />
        ),
      )}
    </div>
  );
}
