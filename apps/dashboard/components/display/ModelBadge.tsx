import { MODEL_META, type ModelKey } from "@llm-usage-lens/shared";

// Design System -- Component Inventory, `ModelBadge`: the model's display name
// with its chart color dot (names and tokens from packages/shared, Rule 20.5).
export function ModelBadge({ model }: { model: ModelKey }) {
  const meta = MODEL_META[model];

  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span
        aria-hidden="true"
        style={{ backgroundColor: `var(${meta.chartToken})` }}
        className="size-2.5 shrink-0 rounded-full"
      />
      {meta.displayName}
    </span>
  );
}
