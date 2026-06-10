"use client"

import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { DayPicker, getDefaultClassNames } from "react-day-picker"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        // `relative` makes the months row the offset parent for the nav bar
        // below, so the prev/next arrows pin to its outer edges.
        months: cn(defaults.months, "relative flex flex-col gap-4 sm:flex-row"),
        month: cn(defaults.month, "flex flex-col gap-4"),
        // Nav spans the top edge; prev pins far-left, next far-right, clear of
        // every day cell (fixes the arrows overlapping the grid in the
        // two-month view). The centered caption has room between them.
        nav: cn(
          defaults.nav,
          "absolute inset-x-0 top-0 flex items-center justify-between"
        ),
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "text-muted-foreground hover:text-foreground"
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "text-muted-foreground hover:text-foreground"
        ),
        month_caption: cn(
          defaults.month_caption,
          "flex h-8 items-center justify-center px-8"
        ),
        caption_label: cn(defaults.caption_label, "text-sm font-medium"),
        month_grid: cn(defaults.month_grid, "w-full border-collapse"),
        weekdays: cn(defaults.weekdays, "flex"),
        weekday: cn(
          defaults.weekday,
          "text-muted-foreground w-9 rounded-md text-[0.8rem] font-normal"
        ),
        week: cn(defaults.week, "mt-2 flex w-full"),
        // The range band is painted on the cell wrapper; the start/end caps get
        // rounded so the indigo selection reads as a continuous pill.
        day: cn(
          defaults.day,
          "relative size-9 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "size-9 rounded-md p-0 font-normal aria-selected:opacity-100"
        ),
        range_start: cn(defaults.range_start, "day-range-start rounded-l-md"),
        range_end: cn(defaults.range_end, "day-range-end rounded-r-md"),
        range_middle: cn(
          defaults.range_middle,
          "rounded-none aria-selected:bg-accent aria-selected:text-accent-foreground"
        ),
        selected: cn(
          defaults.selected,
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground"
        ),
        today: cn(
          defaults.today,
          "bg-accent/60 text-foreground rounded-md font-medium"
        ),
        outside: cn(
          defaults.outside,
          "text-muted-foreground aria-selected:text-muted-foreground"
        ),
        disabled: cn(defaults.disabled, "text-muted-foreground opacity-50"),
        hidden: cn(defaults.hidden, "invisible"),
        ...classNames,
      }}
      components={{
        Chevron: ({
          orientation,
          className: chevronClassName,
          ...chevronProps
        }) =>
          orientation === "left" ? (
            <ChevronLeftIcon
              className={cn("size-4", chevronClassName)}
              {...chevronProps}
            />
          ) : (
            <ChevronRightIcon
              className={cn("size-4", chevronClassName)}
              {...chevronProps}
            />
          ),
      }}
      {...props}
    />
  )
}

export { Calendar }
