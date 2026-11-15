import { useId } from "react";
import type { ComponentProps, ReactElement, ReactNode, RefObject } from "react";

import { cn } from "@/lib/utils";

// Shared form chrome for the Settings access sections (Design System -
// Settings Page, forms: visible label, inline error tied to the field with
// aria-describedby, a 72ch measure).
type FieldChildProps = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
};

export function FormField({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (props: FieldChildProps) => ReactElement;
}) {
  const id = useId();
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="flex max-w-[72ch] flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        "aria-invalid": error !== undefined,
        "aria-describedby": describedBy,
      })}
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function NativeSelect({
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input bg-background h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs outline-none",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function NativeTextarea({
  className,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="native-textarea"
      className={cn(
        "border-input bg-background min-h-20 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

// Radix returns focus only to a DialogTrigger; these dialogs open from plain
// buttons, so the opener is restored by hand (keyboard users keep their place).
export function restoreFocusTo(ref: RefObject<HTMLElement | null>) {
  return (event: Event) => {
    event.preventDefault();
    ref.current?.focus();
  };
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-destructive max-w-[72ch] text-sm">
      {children}
    </p>
  );
}

export function FormStatus({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-muted-foreground max-w-[72ch] text-sm">
      {children}
    </p>
  );
}
