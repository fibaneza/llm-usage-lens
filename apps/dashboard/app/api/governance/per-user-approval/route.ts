import { jsonData, withRoute } from "@/lib/api/respond";
import { getPerUserApproval } from "@/lib/data/access/per-user-approval";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)":
// GET internal-admin or internal-auditor. The setter (PUT) is a later slice.
export const GET = withRoute(
  async () => {
    const approval = await getPerUserApproval();
    return jsonData(
      approval ? { approved: true, ...approval } : { approved: false },
    );
  },
  { requireAdminOrAuditor: true },
);
