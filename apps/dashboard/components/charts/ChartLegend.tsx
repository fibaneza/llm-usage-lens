type ChartLegendItem = {
  key: string;
  label: string;
  // CSS custom property of the series token, e.g. `--color-model-opus`.
  colorVar: string;
};

// Design System -- Chart Colors: a swatch in the series colour beside a
// foreground-coloured label. Series colour is never text colour (it fails
// 4.5:1); replaces Recharts' own `<Legend />`.
export function ChartLegend({ items }: { items: readonly ChartLegendItem[] }) {
  return (
    <ul
      role="list"
      aria-label="Chart legend"
      className="mt-3 flex flex-wrap gap-x-4 gap-y-1"
    >
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: `var(${item.colorVar})` }}
          />
          <span className="text-foreground text-xs">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
