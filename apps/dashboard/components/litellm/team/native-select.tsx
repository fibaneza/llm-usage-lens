import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// A native select styled like components/ui/input (density tokens, Design
// System -- Layout). Native keeps the accessible name and keyboard behaviour
// the team forms rely on.
export function NativeSelect({
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "rounded-control border-input bg-background max-md:min-h-touch h-8 w-full min-w-0 border px-3 py-1 text-sm",
        "focus-visible:ring-focus-ring focus-visible:ring-offset-background outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2",
        "aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
