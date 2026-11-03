"use client";

import {
  MODEL_KEYS,
  MODEL_META,
  type ModelKey,
  ModelKeySchema,
} from "@bedrock-usage/shared";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ModelFilterValue = ModelKey | "all";

type ModelFilterProps = {
  value: ModelFilterValue;
  onChange: (value: ModelFilterValue) => void;
};

function parseValue(raw: string): ModelFilterValue | null {
  if (raw === "all") return "all";
  const parsed = ModelKeySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// Design System -- Component Inventory, `ModelFilter`: a dropdown to filter by
// specific Bedrock model. Display names come from packages/shared (Rule 20.5).
export function ModelFilter({ value, onChange }: ModelFilterProps) {
  return (
    <Select
      value={value}
      onValueChange={(raw) => {
        const next = parseValue(raw);
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger aria-label="Model" className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value="all">All models</SelectItem>
        {MODEL_KEYS.map((key) => (
          <SelectItem key={key} value={key}>
            {MODEL_META[key].displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
