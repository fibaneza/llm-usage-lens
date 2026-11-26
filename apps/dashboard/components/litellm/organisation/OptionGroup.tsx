"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NOT_REPORTED = "Not reported by LiteLLM";

export function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled: ReadonlySet<T>;
}) {
  const labelId = useId();
  const reasonId = useId();
  const anyDisabled = disabled.size > 0;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span id={labelId} className="text-muted-foreground text-xs font-medium">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-1"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={option.value}
              type="button"
              aria-pressed={selected}
              aria-describedby={
                disabled.has(option.value) ? reasonId : undefined
              }
              disabled={disabled.has(option.value)}
              variant={selected ? "secondary" : "outline"}
              size="sm"
              className={cn(selected && "border-border border font-semibold")}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
      {anyDisabled ? (
        <span id={reasonId} className="text-muted-foreground text-xs">
          {NOT_REPORTED}
        </span>
      ) : null}
    </div>
  );
}
