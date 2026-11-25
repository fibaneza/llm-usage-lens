"use client";

import { Info } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Design System - Component Inventory, FieldHelp (D-R3-10): click/Enter popover, never hover-only.
export function FieldHelp({
  field,
  children,
}: {
  field: string;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`About ${field}`}
        >
          <Info aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="text-sm"
        onCloseAutoFocus={(event) => {
          // Radix skips the focus return after an outside click; the spec requires it.
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
