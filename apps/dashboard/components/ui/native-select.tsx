import { ChevronDown } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

const SIZING_TOKEN = /^(?:[\w-]+:)*-?(?:w|min-w|max-w)-\S+$/

// The wrapper is the sized box the chevron is positioned in, so width classes
// (including responsive/state-prefixed ones) go to it; the rest go to the select.
function splitSizingClasses(className: string | undefined) {
  const sizing: string[] = []
  const rest: string[] = []
  for (const token of (className ?? "").split(/\s+/).filter(Boolean)) {
    ;(SIZING_TOKEN.test(token) ? sizing : rest).push(token)
  }
  return { sizing: sizing.join(" "), rest: rest.join(" ") }
}

// Design System - Component Inventory, NativeSelect: a native select with a
// token-spaced chevron instead of the browser arrow.
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  const { sizing, rest } = splitSizingClasses(className)
  return (
    <div className={cn("relative w-full min-w-0", sizing)}>
      <select
        data-slot="native-select"
        className={cn(
          "h-8 w-full appearance-none rounded-control border border-input bg-transparent py-1 pl-3 pr-9 text-base transition-colors max-md:min-h-touch disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "aria-invalid:border-destructive",
          rest
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export { NativeSelect }
