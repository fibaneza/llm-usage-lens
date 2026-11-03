// Design System -- Charts and Data: an empty chart says so instead of
// rendering blank axes.
export function ChartEmptyState() {
  return (
    <p className="text-muted-foreground flex h-48 items-center justify-center text-sm">
      No data yet
    </p>
  );
}
