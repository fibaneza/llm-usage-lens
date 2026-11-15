import { DepartmentVisibilitySchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { IdParamSchema } from "@/lib/api/id-param";
import {
  loadManager,
  matrixWrite,
  notFoundResponse,
} from "@/lib/api/matrix-route";
import { findDepartment } from "@/lib/api/org-lookup";
import {
  jsonData,
  parseInput,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { canManageRead } from "@/lib/auth/write-policy";
import {
  getVisibility,
  putDepartmentVisibility,
} from "@/lib/data/access/visibility";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/departments/[id]/visibility GET read in scope, PUT per matrix),
// "Visibility and inheritance" (department defaults hidden/own at version 0),
// "Permission matrix" (a department-scope admin edits its department and cap;
// a team-scope admin never), "Enforcement" item 6.
type DepartmentContext = { params: Promise<{ id: string }> };

const getHandler = withRoute(async (_request, ctx, session) => {
  const departmentId = parseInput((await ctx.params).id, IdParamSchema);
  const actor = await loadManager(session);
  const department = await findDepartment(departmentId);
  if (!actor || !canManageRead(actor, { departmentId: department })) {
    return notFoundResponse();
  }
  const { departments } = await getVisibility({
    teamIds: [],
    departmentIds: [departmentId],
  });
  return jsonData(
    DepartmentVisibilitySchema.parse(departments.get(departmentId)),
  );
});

const putHandler = matrixWrite(
  {
    operation: "department-visibility",
    action: "visibility.update",
    pattern: "/api/departments/[id]/visibility",
  },
  async ({ request, params, session, refuse }) => {
    const departmentId = parseInput(params.id, IdParamSchema);
    const department = await findDepartment(departmentId);
    const refusal = await refuse({
      operation: "department-visibility",
      departmentId: department,
    });
    if (refusal) return refusal;
    const body = await parseJsonBody(
      request,
      z
        .object({
          departmentId: z.string().optional(),
          departmentLevel: z.enum(["visible", "hidden"]),
          maxUserLevel: z.enum(["all", "own", "none"]),
          version: z.number().int().min(0),
        })
        .refine(
          (b) =>
            b.departmentId === undefined || b.departmentId === departmentId,
          { message: "Body departmentId must equal the path departmentId" },
        ),
    );
    const result = await putDepartmentVisibility(
      {
        departmentId,
        departmentLevel: body.departmentLevel,
        maxUserLevel: body.maxUserLevel,
        version: body.version === 0 ? null : body.version,
      },
      auditContext(session),
    );
    if (!result.ok) {
      return accessErrorResponse(
        result.code === "NOT_FOUND" ? "CONFLICT" : result.code,
      );
    }
    return jsonData(DepartmentVisibilitySchema.parse(result.value));
  },
);

export const GET = (request: Request, ctx: DepartmentContext) =>
  getHandler(request, ctx);
export const PUT = (request: Request, ctx: DepartmentContext) =>
  putHandler(request, ctx);
