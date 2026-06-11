import { z } from "zod";

// Building-block schemas shared by the entity and query schemas.
// Source: docs/specs/2026-05-15-data-model.md — "Conventions".

export const AccountIdSchema = z
  .string()
  .regex(/^\d{12}$/, "Expected a 12-digit AWS account ID");

// ISO8601 timestamps (lastRunAt, createdAt, …). The collector writes
// Date#toISOString() (UTC "Z"); offsets are accepted as valid ISO8601.
export const Iso8601Schema = z.iso.datetime({ offset: true });

// Parse a `YYYY-MM-DD` string as UTC-midnight epoch ms, mirroring
// apps/dashboard/lib/date-range.ts (Rule 20.1 — UTC everywhere; no
// local-timezone Date parsing). Returns null for impossible calendar dates:
// `new Date("2026-02-31")` would silently roll over to March, so the parsed
// parts must round-trip exactly.
export function parseUtcDayMs(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const parsed = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;

  return roundTrips ? parsed.getTime() : null;
}

// A UTC calendar day, the unit of all date bucketing (DAILY#{YYYY-MM-DD}).
export const UtcDaySchema = z
  .string()
  .refine(
    (value) => parseUtcDayMs(value) !== null,
    "Expected a valid UTC calendar date in YYYY-MM-DD format",
  );
