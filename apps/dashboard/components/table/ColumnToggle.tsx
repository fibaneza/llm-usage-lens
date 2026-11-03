"use client";

import { Columns3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ToggleableColumn = {
  id: string;
  label: string;
  visible: boolean;
};

type ColumnToggleProps = {
  columns: ToggleableColumn[];
  onToggle: (id: string, visible: boolean) => void;
};

// Design System -- Component Inventory, `ColumnToggle`: show/hide table
// columns through a DropdownMenu of checkbox items.
export function ColumnToggle({ columns, onToggle }: ColumnToggleProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Columns3 aria-hidden />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.visible}
            onCheckedChange={(checked) => onToggle(column.id, checked)}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
