"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type TeamLinkOption = {
  id: string;
  primary: string;
  secondary: string;
  linked: boolean;
};

type TeamLinkPickerProps = {
  label: string;
  options: readonly TeamLinkOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
};

// Source: Design System - Management improvements, D4a (2026-11-17): a
// searchable list, never a typed id; an option that already has a link shows
// "linked" and cannot be chosen (the link is one-to-one). The server still
// validates both ids (LT-MI3).
export function TeamLinkPicker({
  label,
  options,
  value,
  onChange,
  placeholder,
}: TeamLinkPickerProps) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={labelId}
            className="justify-between"
          >
            <span className="truncate">
              {selected ? selected.primary : placeholder}
            </span>
            <ChevronsUpDown aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <Command>
            <CommandInput aria-label={`Search ${label}`} placeholder="Search" />
            <CommandList>
              <CommandEmpty>No match</CommandEmpty>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.primary} ${option.id}`}
                  disabled={option.linked}
                  onSelect={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    aria-hidden
                    className={option.id === value ? "" : "invisible"}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{option.primary}</span>
                    <span className="text-muted-foreground truncate font-mono text-xs">
                      {option.secondary}
                    </span>
                  </span>
                  {option.linked ? (
                    <span className="text-muted-foreground text-xs">
                      linked
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
