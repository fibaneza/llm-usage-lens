import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

// Source: docs/specs/2026-11-10-access-control.md — "Storage boundary (D26.4)":
// list functions hand out an opaque, signed cursor, never a raw
// LastEvaluatedKey. Format: base64url(json).base64url(HMAC-SHA256).
const KeySchema = z.record(z.string(), z.string());
export type CursorKey = z.infer<typeof KeySchema>;

export type DecodedCursor =
  | { ok: true; value: CursorKey }
  | { ok: false; code: "BAD_CURSOR" };

const BAD: DecodedCursor = { ok: false, code: "BAD_CURSOR" };

const sign = (payload: string, secret: string): Buffer =>
  createHmac("sha256", secret).update(payload).digest();

export function encodeCursor(key: CursorKey, secret: string): string {
  const payload = Buffer.from(JSON.stringify(key), "utf8").toString(
    "base64url",
  );
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

export function decodeCursor(cursor: string, secret: string): DecodedCursor {
  const parts = cursor.split(".");
  if (parts.length !== 2) return BAD;
  const [payload, signature] = parts;
  if (!payload || !signature) return BAD;
  const given = Buffer.from(signature, "base64url");
  const expected = sign(payload, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return BAD;
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return BAD;
  }
  const parsed = KeySchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : BAD;
}
