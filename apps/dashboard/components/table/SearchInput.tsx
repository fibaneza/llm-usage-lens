"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  hideLabel?: boolean;
  maxLength?: number;
  delayMs?: number;
};

// Design System -- Component Inventory, `SearchInput`: a debounced text filter.
// Typed text shows at once; `onChange` fires once the user pauses for `delayMs`.
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  hideLabel = false,
  maxLength,
  delayMs = 300,
}: SearchInputProps) {
  const inputId = useId();
  const showLabel = label !== undefined && !hideLabel;
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="flex w-full max-w-xs flex-col gap-1">
      {showLabel ? (
        <label htmlFor={inputId} className="text-sm font-medium">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          id={inputId}
          type="search"
          aria-label={
            showLabel ? undefined : (label ?? placeholder ?? "Search")
          }
          placeholder={placeholder}
          maxLength={maxLength}
          value={draft}
          className="pl-8"
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            clearTimeout(timer.current);
            if (delayMs <= 0) {
              lastEmitted.current = next;
              onChange(next);
              return;
            }
            timer.current = setTimeout(() => {
              lastEmitted.current = next;
              onChange(next);
            }, delayMs);
          }}
        />
      </div>
    </div>
  );
}
