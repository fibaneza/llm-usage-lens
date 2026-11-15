// LiteLLM spec -- LD20: LiteLLM timestamps are shown in Australia/Sydney with
// the zone abbreviation (AEDT in summer, AEST in winter).
// en-AU renders "July"/"Sept" for the short month, so the name is fixed here.
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const FORMATTER = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

export function formatSydneyTime(iso: string | null): string {
  if (iso === null) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const parts = FORMATTER.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")} ${MONTHS[Number(part("month")) - 1] ?? ""} ${part("year")}, ${part("hour")}:${part("minute")} ${part("timeZoneName")}`;
}
