"use client";

import { useEffect, useState } from "react";

const TICK_MS = 1_000;
const MS_PER_MINUTE = 60_000;

// Whole minutes (rounded up, floored at 0) until `target`, re-evaluated every
// second so the countdown follows the wall clock. `null` when there is no
// target; an overdue target reads 0, never a negative (Rule 20.9).
export function useMinutesUntil(target: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (target === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [target]);

  if (target === undefined) return null;
  const remaining = Date.parse(target) - now;
  if (Number.isNaN(remaining)) return null;
  return Math.max(0, Math.ceil(remaining / MS_PER_MINUTE));
}
