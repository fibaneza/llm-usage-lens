import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-sm font-medium whitespace-nowrap transition-all outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90",
        outline:
          "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 py-2 has-[>svg]:px-2.5 max-md:min-h-touch",
        xs: "h-6 gap-1 rounded-control px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-control px-3 has-[>svg]:px-2.5 max-md:min-h-touch",
        lg: "h-10 rounded-control px-6 has-[>svg]:px-4 max-md:min-h-touch",
        icon: "size-8 max-md:min-h-touch max-md:min-w-touch",
        "icon-xs": "size-6 rounded-control [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 max-md:min-h-touch max-md:min-w-touch",
        "icon-lg": "size-10 max-md:min-h-touch max-md:min-w-touch",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
