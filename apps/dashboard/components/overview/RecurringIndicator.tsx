import type { NonModelCategory } from "@bedrock-usage/shared";
import { Repeat } from "lucide-react";

type RecurringIndicatorProps = {
  categories: readonly NonModelCategory[];
};

function categoryName(category: NonModelCategory): string {
  const words = category.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Flags recurring non-model charges (e.g. Provisioned Throughput) that accrue
// whether or not any tokens are used (Data Model spec — Non-Model Charges).
// Renders nothing when no category is recurring.
export function RecurringIndicator({ categories }: RecurringIndicatorProps) {
  if (categories.length === 0) return null;

  return (
    <p className="text-foreground mt-1 inline-flex items-center gap-1 font-medium">
      <Repeat className="size-3 shrink-0" aria-hidden />
      {`Recurring: ${categories.map(categoryName).join(", ")}`}
    </p>
  );
}
