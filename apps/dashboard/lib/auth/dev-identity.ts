import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  findIdentityByEmail,
  findIdentityByOid,
} from "@/lib/data/access/identities";
import { MASTER_OID_PREFIX } from "@/lib/auth/master-oid";

// Source: docs/specs/2026-11-10-access-control.md - "Dev login" (L3c). An
// optional identity: an email or a dashboard oid. No role is read from it; the
// role comes only from the sign-in form. Server-only by construction: the
// DynamoDB lookups are loaded on demand from the server-only data layer, so
// the empty identity (today's local developer) needs no store.
const LOCAL_DEFAULT_EMAIL = "dev@localhost";
const MAX_LENGTH = 254;

export type DevIdentity = { oid: string; email?: string; name: string };
export type DevIdentityResult =
  | { ok: true; identity: DevIdentity }
  | { ok: false };

const TokenSchema = z
  .string()
  .max(MAX_LENGTH)
  .regex(/^[^\p{Cc}\s]+$/u);
const EmailSchema = z.email();
const OidSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/);

const LOCAL_IDENTITY: DevIdentity = {
  oid: `local:${LOCAL_DEFAULT_EMAIL}`,
  email: LOCAL_DEFAULT_EMAIL,
  name: "Local Developer",
};

function fromStored(match: {
  oid: string;
  email?: string;
  displayName?: string;
}): DevIdentity {
  return {
    oid: match.oid,
    ...(match.email ? { email: match.email } : {}),
    name: match.displayName ?? match.email ?? match.oid,
  };
}

export async function resolveDevIdentity(
  input: unknown,
): Promise<DevIdentityResult> {
  if (input === undefined || input === "") {
    return { ok: true, identity: LOCAL_IDENTITY };
  }
  const token = TokenSchema.safeParse(input);
  if (!token.success) return { ok: false };
  if (token.data.toLowerCase().startsWith(MASTER_OID_PREFIX)) {
    return { ok: false };
  }

  if (token.data.includes("@")) {
    const email = EmailSchema.safeParse(token.data);
    if (!email.success) return { ok: false };
    const lowered = email.data.toLowerCase();
    const stored = await findIdentityByEmail(lowered);
    if (stored) return { ok: true, identity: fromStored(stored) };
    const digest = createHash("sha256").update(lowered).digest("hex");
    return {
      ok: true,
      identity: {
        oid: `dev-${digest.slice(0, 32)}`,
        email: lowered,
        name: lowered,
      },
    };
  }

  const oid = OidSchema.safeParse(token.data);
  if (!oid.success) return { ok: false };
  const stored = await findIdentityByOid(oid.data);
  return stored ? { ok: true, identity: fromStored(stored) } : { ok: false };
}
