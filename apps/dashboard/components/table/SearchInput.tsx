"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  delayMs?: number;
};

// Design System -- Component Inventory, `SearchInput`: a debounced text filter.
// Typed text shows at once; `onChange` fires once the user pauses for `delayMs`.
export function SearchInput({
  value,
  onChange,
  placeholder,
  delayMs = 300,
}: SearchInputProps) {
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
    <div className="relative w-full max-w-xs">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        type="search"
        aria-label={placeholder ?? "Search"}
        placeholder={placeholder}
        value={draft}
        className="pl-8"
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            lastEmitted.current = next;
            onChange(next);
          }, delayMs);
        }}
      />
    </div>
  );
}
