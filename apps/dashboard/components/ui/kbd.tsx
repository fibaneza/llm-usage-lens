import * as React from "react"

import { cn } from "@/lib/utils"

// Keyboard-shortcut hint (e.g. ⌘K). Pure presentational primitive — no client
// behaviour, so it stays a Server Component (Rule 60.7) and can render inside
// either server or client trees. Semantic tokens only (Rule 40.2).
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground select-none",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
