import {
  IdentityLinkSchema,
  canonicalUsageIdentity,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { IdParamSchema } from "@/lib/api/id-param";
import {
  jsonData,
  jsonError,
  parseInput,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { identityExists, ownEmail } from "@/lib/data/access/identities";
import {
  getIdentityLink,
  putIdentityLink,
} from "@/lib/data/access/identity-links";
import { notFoundResponse } from "@/lib/api/matrix-route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/identities/[oid]/links GET internal-admin or internal-auditor, PUT
// internal-admin), "Identity links" (a key belongs to one person: 409; a key
// that is another identity's email: 409; aliases are non-person keys only; links
// never grant access), "Canonical usage identity" (lower-cased; matching is
// exact, so keys are stored lower-cased on both sides), "Data model additions"
// (the version convention: no link reads as version 0, and a PUT with
// version 0 creates).
type LinkContext = { params: Promise<{ oid: string }> };

const EMPTY_LINK_AT = new Date(0).toISOString();

const getHandler = withRoute(
  async (_request, ctx) => {
    const oid = parseInput((await ctx.params).oid, IdParamSchema);
    if (!(await identityExists(oid))) return notFoundResponse();
    const link = await getIdentityLink(oid);
    return jsonData(
      IdentityLinkSchema.parse(
        link ?? {
          oid,
          usageIdentities: [],
          aliases: [],
          version: 0,
          updatedAt: EMPTY_LINK_AT,
        },
      ),
    );
  },
  { requireAdminOrAuditor: true },
);

// TransactWriteItems holds 100 items: the link, the audit record and one claim
// or release per key stay well inside it.
const MAX_KEYS = 20;
const KeySchema = z
  .string()
  .min(1)
  .max(254)
  .transform((key) => key.trim().toLowerCase())
  .pipe(z.string().min(1));

const LinkBodySchema = z
  .object({
    oid: z.string().optional(),
    usageIdentities: z.array(KeySchema).max(MAX_KEYS),
    aliases: z.array(KeySchema).max(MAX_KEYS),
    litellmUserId: z.string().min(1).max(254).optional(),
    version: z.number().int().min(0),
  })
  .refine(
    (body) => {
      const all = [...body.usageIdentities, ...body.aliases];
      return new Set(all).size === all.length;
    },
    { message: "A key may appear once across usageIdentities and aliases" },
  );

const putHandler = withRoute(
  async (request, ctx, session) => {
    const oid = parseInput((await ctx.params).oid, IdParamSchema);
    const body = await parseJsonBody(
      request,
      LinkBodySchema.refine((b) => b.oid === undefined || b.oid === oid, {
        message: "Body oid must equal the path oid",
      }),
    );
    if (!(await identityExists(oid))) return notFoundResponse();
    // T16: a link holds at most this person's own canonical email as a
    // person-kind key, and only as a usage identity; any other person-kind key,
    // or any person-kind alias, would show its holder someone's usage.
    const own = await ownEmail(oid);
    const isForeignPerson = (key: string, alias: boolean) => {
      const identity = canonicalUsageIdentity(key);
      if (identity.kind !== "person") return false;
      return alias || identity.key !== own;
    };
    if (
      body.usageIdentities.some((k) => isForeignPerson(k, false)) ||
      body.aliases.some((k) => isForeignPerson(k, true))
    ) {
      return jsonError(409, "CONFLICT", "A key belongs to a person");
    }
    const result = await putIdentityLink(
      {
        oid,
        usageIdentities: body.usageIdentities,
        aliases: body.aliases,
        ...(body.litellmUserId !== undefined
          ? { litellmUserId: body.litellmUserId }
          : {}),
        version: body.version === 0 ? null : body.version,
      },
      auditContext(session),
    );
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(IdentityLinkSchema.parse(result.value));
  },
  {
    requireAdmin: true,
    denied: {
      action: "identity.link.update",
      pattern: "/api/identities/[oid]/links",
    },
  },
);

export const GET = (request: Request, ctx: LinkContext) =>
  getHandler(request, ctx);
export const PUT = (request: Request, ctx: LinkContext) =>
  putHandler(request, ctx);
