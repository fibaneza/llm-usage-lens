import { Skeleton } from "@/components/ui/skeleton";

// Design System -- States, Loading: skeletons match the final geometry so the
// page does not jump when data arrives.
export function KpiSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, slot) => `kpi-${slot + 1}`).map(
        (key) => (
          <Skeleton key={key} className="rounded-card h-[88px] w-full" />
        ),
      )}
    </>
  );
}
