type ScopeLineProps = {
  label: string;
  names: readonly string[];
};

// Design System -- Layout, Page frame: states the caller's scope under the
// page description ("Showing teams you lead: Platform, Checkout").
export function ScopeLine({ label, names }: ScopeLineProps) {
  if (names.length === 0) return null;
  return (
    <p className="text-cell text-muted-foreground max-w-[72ch]">
      {label}: {names.join(", ")}
    </p>
  );
}
