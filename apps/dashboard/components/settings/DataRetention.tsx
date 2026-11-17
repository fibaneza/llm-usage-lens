// Data Model — "TTL" and "Data Retention": read-only; the TTL is a deployment
// setting, not a dashboard control. System Architecture — "Configuration file"
// (data.retention.dailyRollupDays, A12): the declared value and its source.
export function DataRetention({
  days = 365,
  source = "default",
}: {
  days?: number;
  source?: "file" | "default";
}) {
  return (
    <p className="text-muted-foreground text-sm">
      Each DailyRollup expires {days} days after it was last updated. The
      retention period is configured per deployment and cannot be changed here.
      {source === "file" ? " Set in config.yaml." : null}
    </p>
  );
}
