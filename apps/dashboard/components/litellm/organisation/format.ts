const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export const formatCount = (value: number): string =>
  integerFormatter.format(value);

export type WeekBucket = {
  key: string;
  label: string;
  days: string[];
  part: boolean;
};

const DAY_MS = 86_400_000;
const weekLabelFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

// Monday-to-Sunday UTC weeks (Rule 20.1; Design System -- Organisation spend
// chart, unit OC2). The key is the Monday even when it precedes the range.
export function weeklyBuckets(days: string[]): WeekBucket[] {
  const buckets: WeekBucket[] = [];
  const byKey = new Map<string, WeekBucket>();
  for (const day of days) {
    const time = Date.parse(`${day}T00:00:00Z`);
    const sinceMonday = (new Date(time).getUTCDay() + 6) % 7;
    const monday = time - sinceMonday * DAY_MS;
    const key = new Date(monday).toISOString().slice(0, 10);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: `Week of ${weekLabelFormatter.format(new Date(monday))}`,
        days: [],
        part: false,
      };
      byKey.set(key, bucket);
      buckets.push(bucket);
    }
    bucket.days.push(day);
  }
  for (const bucket of buckets) bucket.part = bucket.days.length < 7;
  return buckets;
}
