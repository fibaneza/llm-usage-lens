import { z } from "zod";

import { IdParamSchema } from "@/lib/api/id-param";

// Source: docs/specs/2026-11-10-access-control.md - "Enforcement" item 6 (Zod
// bodies; a body teamId or departmentId must equal the path, else 400) and
// "Membership, admin scopes and lifecycle" (Joiner: a person is an `oid` or a
// pending work email or UPN).
export const VersionBodySchema = z.object({
  version: z.number().int().min(1),
});

export type PersonRef = { oid: string } | { emailOrUpn: string };

export function personBodySchema(path: {
  key: "teamId" | "departmentId";
  value: string;
}) {
  return z
    .object({
      oid: IdParamSchema.optional(),
      emailOrUpn: z.email().max(254).optional(),
      teamId: z.string().optional(),
      departmentId: z.string().optional(),
    })
    .refine(
      (body) => (body.oid === undefined) !== (body.emailOrUpn === undefined),
      {
        message: "Provide exactly one of oid or emailOrUpn",
      },
    )
    .refine(
      (body) => body[path.key] === undefined || body[path.key] === path.value,
      {
        message: `Body ${path.key} must equal the path ${path.key}`,
      },
    )
    .transform(
      (body): PersonRef =>
        body.oid !== undefined
          ? { oid: body.oid }
          : { emailOrUpn: body.emailOrUpn ?? "" },
    );
}

// A path or body oid names a pending person when it is an address.
export const isPendingKey = (value: string): boolean => value.includes("@");
