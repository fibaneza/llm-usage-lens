type PercentOfTotalBarProps = {
  value: number;
};

function toPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return Math.round(clamped * 1000) / 10;
}

// Design System -- Component Inventory, `PercentOfTotalBar`: an inline bar
// showing proportion in ranking tables. `value` is a fraction from 0 to 1; the
// visible text carries the same figure so the bar is not the only cue.
export function PercentOfTotalBar({ value }: PercentOfTotalBarProps) {
  const percent = toPercent(value);
  const label = `${percent.toFixed(1)}%`;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <div
        role="meter"
        aria-label="Percent of total"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={label}
        className="bg-muted h-2 w-10 shrink-0 overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums">{label}</span>
    </div>
  );
}
