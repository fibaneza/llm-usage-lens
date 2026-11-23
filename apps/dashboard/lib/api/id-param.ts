import { z } from "zod";

// Data Model spec — API Routes: path ids are 1–128 characters with no C0
// control characters or U+007F (400 otherwise).
export const IdParamSchema = z
  .string()
  .min(1, "Invalid id")
  .max(128, "Invalid id")
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]+$/, "Invalid id");

// A page segment's `params` value arrives percent-encoded in this Next version
// (`getDynamicParam` re-encodes it with encodeURIComponent; Route Handlers get
// it decoded), so `local:<uuid>` reaches a page as `local%3A<uuid>`. Decode
// once, then apply the same path-id rule; a malformed escape is invalid.
export function parsePageIdParam(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const parsed = IdParamSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}
