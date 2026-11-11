import { z } from "zod";

// Data Model spec — API Routes: path ids are 1–128 characters with no C0
// control characters or U+007F (400 otherwise).
export const IdParamSchema = z
  .string()
  .min(1, "Invalid id")
  .max(128, "Invalid id")
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]+$/, "Invalid id");
