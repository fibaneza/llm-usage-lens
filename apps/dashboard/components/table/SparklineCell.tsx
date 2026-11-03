type SparklineCellProps = {
  points: number[];
  label: string;
};

const WIDTH = 80;
const HEIGHT = 24;
const PADDING = 2;

function toPolylinePoints(values: number[]): string {
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  const step = (WIDTH - PADDING * 2) / (values.length - 1);
  const drawable = HEIGHT - PADDING * 2;

  return values
    .map((value, index) => {
      const x = PADDING + index * step;
      const y =
        range === 0
          ? HEIGHT / 2
          : PADDING + drawable - ((value - min) / range) * drawable;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

// Design System -- Component Inventory, `SparklineCell`: an inline trend line
// for table cells. A plain SVG polyline -- Recharts is too heavy per cell.
export function SparklineCell({ points, label }: SparklineCellProps) {
  if (points.length < 2) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      className="shrink-0"
    >
      <polyline
        points={toPolylinePoints(points)}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary"
      />
    </svg>
  );
}
