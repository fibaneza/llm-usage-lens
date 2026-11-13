import { randomBytes } from "node:crypto";

import { GLOBAL_ROLES } from "./roles";

// Source: docs/specs/2026-11-10-access-control.md — "Password users" (TOTP,
// D23). RFC 4648 base32, 160-bit secret.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const VIEWER_ROLE = "internal-viewer";

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
  }
  return out;
}

// Required for any global role other than internal-viewer, or any admin scope.
export async function isTotpRequired(oid: string): Promise<boolean> {
  // Loaded lazily so the pure secret generator stays importable client-free.
  const { getAccessSummary } =
    await import("@/lib/data/access/password-credentials-store");
  const { roles, hasAdminScope } = await getAccessSummary(oid);
  if (hasAdminScope) return true;
  return roles.some(
    (role) =>
      role !== VIEWER_ROLE &&
      (GLOBAL_ROLES as readonly string[]).includes(role),
  );
}
