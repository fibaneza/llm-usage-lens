"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type DepartmentOption = { departmentId: string; departmentName: string };

type DepartmentFilterProps = {
  value: string | null;
  options: DepartmentOption[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
};

const ALL = "all";

// "all" is the absence of the URL param.
export function DepartmentFilter({
  value,
  options,
  onChange,
  disabled = false,
}: DepartmentFilterProps) {
  return (
    <Select
      value={value ?? ALL}
      disabled={disabled}
      onValueChange={(raw) => onChange(raw === ALL ? null : raw)}
    >
      <SelectTrigger aria-label="Department" className="w-52">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value={ALL}>All departments</SelectItem>
        {options.map((d) => (
          <SelectItem key={d.departmentId} value={d.departmentId}>
            {d.departmentName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
