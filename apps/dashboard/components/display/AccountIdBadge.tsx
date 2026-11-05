"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";

const COPIED_MS = 2_000;

function formatAccountId(accountId: string): string {
  return accountId.replace(/(\d{3})(?=\d)/g, "$1-");
}

// Design System -- Component Inventory, `AccountIdBadge`: the AWS account ID
// as 123-456-789-012 with an icon-only copy button. The raw ID is copied; the
// polite status region announces success.
export function AccountIdBadge({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const formatted = formatAccountId(accountId);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let next: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(accountId);
    } catch {
      next = "failed";
    }
    setStatus(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), COPIED_MS);
  }

  return (
    <Badge variant="outline" className="gap-1.5 font-mono font-normal">
      <span>{formatted}</span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy account ID ${formatted}`}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        {status === "copied" ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
      <span role="status" className="sr-only">
        {status === "copied"
          ? "Copied"
          : status === "failed"
            ? "Copy failed"
            : ""}
      </span>
    </Badge>
  );
}
