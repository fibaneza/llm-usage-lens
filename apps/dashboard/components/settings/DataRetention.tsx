// Data Model — "TTL" and "Data Retention": read-only; the TTL is a deployment
// setting, not a dashboard control.
export function DataRetention() {
  return (
    <p className="text-muted-foreground text-sm">
      Each DailyRollup expires 365 days after it was last updated. The retention
      period is configured per deployment and cannot be changed here.
    </p>
  );
}
