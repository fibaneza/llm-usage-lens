// Last-run time is shown in explicit UTC, never the host timezone (Rule 20.1).
const lastRunFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export function formatLastRun(lastRunAt: string): string {
  return `${lastRunFormatter.format(new Date(lastRunAt))} UTC`;
}
