import { Skeleton } from "@/components/ui/skeleton";

export function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}
