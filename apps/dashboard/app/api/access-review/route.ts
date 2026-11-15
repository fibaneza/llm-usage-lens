import { auditContext } from "@/lib/api/access-route";
import { withRoute } from "@/lib/api/respond";
import { exportAccessReview } from "@/lib/data/access/access-review";
import type { AccessReviewRow } from "@/lib/data/access/access-review";

// Source: docs/specs/2026-11-10-access-control.md - "Access review" (CSV
// columns, "The export is audited"), "API routes (additions)" (/api/access-review
// GET internal-admin or internal-auditor), "Enforcement" item 4 (no-store).
// The LiteLLM link column is present and empty until the LiteLLM units fill it.
const HEADER = [
  "oid",
  "email",
  "displayName",
  "authMethod",
  "globalRoles",
  "team",
  "adminScopes",
  "lastSignInAt",
  "aliases",
  "litellmLink",
  "flags",
] as const;

// CSV injection: a spreadsheet runs a cell that starts with = + - @ tab or CR.
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function rowCells(row: AccessReviewRow): string[] {
  return [
    row.oid,
    row.email,
    row.displayName,
    row.authMethod,
    row.roles.map((r) => `${r.role} (${r.source})`).join("; "),
    row.team ? `${row.team.teamId} (${row.team.source})` : "",
    row.adminScopes
      .map((s) => `${s.scopeType}:${s.scopeId} (${s.source})`)
      .join("; "),
    row.lastSignInAt,
    row.aliases.join("; "),
    "",
    row.flags.join("; "),
  ];
}

export const GET = withRoute(
  async (_request, _ctx, session) => {
    const ctx = auditContext(session);
    const { date, rows } = await exportAccessReview(ctx);
    const lines = [[...HEADER], ...rows.map(rowCells)].map((cells) =>
      cells.map(cell).join(","),
    );
    return new Response(`${lines.join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="access-review-${date}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  },
  { requireAdminOrAuditor: true },
);
