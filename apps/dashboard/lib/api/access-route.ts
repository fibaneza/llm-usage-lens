import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import type { Session } from "next-auth";
import { z } from "zod";

import { env } from "@/env";
import {
  NOT_FOUND_MESSAGE,
  jsonError,
  parseSearchParams,
} from "@/lib/api/respond";
import type { AccessErrorCode, AuditContext } from "@/lib/data/access/result";

// Source: docs/specs/2026-11-10-access-control.md - "Storage boundary (D26)",
// "Enforcement" items 4 and 6. Shared plumbing for the access-control Route
// Handlers: audit context, list paging and AccessResult -> response mapping.

// A path group id: 1-128 characters of letters, digits and `._:-` (an Entra
// group object id is a GUID).
export const GroupIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/, "Invalid group id");

const ListQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/, "limit must be a positive integer")
    .transform(Number)
    .optional(),
  cursor: z.string().min(1).max(2048).optional(),
});

// The cursor HMAC key is derived from AUTH_SECRET (never the secret itself).
// AUTH_SECRET is required: with none there is no key, and the call fails
// closed (user decision 2026-11-15; Rule 60.19).
export function cursorSecret(): string {
  const base = env.AUTH_SECRET;
  if (!base) throw new Error("AUTH_SECRET is required to sign list cursors");
  return createHmac("sha256", base).update("access-list-cursor").digest("hex");
}

export function listOptions(request: Request) {
  const { limit, cursor } = parseSearchParams(request, ListQuerySchema);
  return {
    cursorSecret: cursorSecret(),
    ...(limit !== undefined ? { limit } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  };
}

export function auditContext(session: Session): AuditContext {
  return {
    actor: session.user.oid,
    requestId: randomUUID(),
    now: new Date(),
    sequence: { next: 0 },
  };
}

// Expected data-layer outcomes -> registry codes. A missing and an
// out-of-scope target share one body (no id echoed; spec T15).
export function accessErrorResponse(code: AccessErrorCode): Response {
  switch (code) {
    case "NOT_FOUND":
      return jsonError(404, "NOT_FOUND", NOT_FOUND_MESSAGE);
    case "BAD_CURSOR":
      return jsonError(400, "BAD_REQUEST", "Invalid cursor");
    case "MANAGED_BY_SSO":
      return jsonError(
        409,
        "MANAGED_BY_SSO",
        "The resource is managed by single sign-on",
      );
    case "ALREADY_AFFILIATED":
      return jsonError(
        409,
        "ALREADY_AFFILIATED",
        "The user is already affiliated with a team",
      );
    case "CONFLICT":
      return jsonError(409, "CONFLICT", "The resource changed or conflicts");
    default: {
      const unreachable: never = code;
      throw new Error(`Unhandled access error code: ${String(unreachable)}`);
    }
  }
}

// Spec - Password users D24: password sign-in may be turned off, and the last
// password admin is no longer protected, only once Entra is configured.
export function entraConfigured(): boolean {
  return Boolean(
    env.AUTH_MICROSOFT_ENTRA_ID_ID &&
    env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
    env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
  );
}
