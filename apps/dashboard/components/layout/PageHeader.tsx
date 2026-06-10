import { DateRangePicker } from "@/components/filters/DateRangePicker";

// The in-content page header band (design-system — Structure: "Page Header +
// Date Range Filter"). The descriptive page <h1> lives in the top bar
// (AppHeader/PageTitle), so this band carries an optional page description on
// the left and the global DateRangePicker on the right — no duplicate heading.
// The date filter scopes every chart and table on the page (design-system —
// Date Filtering) and persists in the URL via nuqs. Server-compatible: the
// "use client" boundary stays inside DateRangePicker (Rule 60.7).
export function PageHeader({ description }: { description?: string }) {
  return (
    <div className="border-border mb-6 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center">
      {description ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
      <div className="sm:ml-auto">
        <DateRangePicker />
      </div>
    </div>
  );
}
