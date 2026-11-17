import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { withBasePath } from "@/lib/base-path";

// Source: docs/specs/2026-11-10-access-control.md - "Access review" (a CSV of
// every identity with roles and sources, member team and admin scopes,
// lastSignInAt, aliases, the LiteLLM link and flags; the export is audited),
// "API routes (additions)" (GET /api/access-review, text/csv, attachment). A
// same-origin link: the browser follows the route's Content-Disposition.
export function AccessReviewSection() {
  return (
    <div className="flex max-w-[72ch] flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Download a CSV of every identity with its roles, team and admin scopes,
        last sign-in, aliases, LiteLLM link and review flags. Each export is
        recorded in the audit log.
      </p>
      <div>
        <Button asChild variant="outline" size="sm">
          <a href={withBasePath("/api/access-review")} download>
            <Download aria-hidden />
            Export access review (CSV)
          </a>
        </Button>
      </div>
    </div>
  );
}
