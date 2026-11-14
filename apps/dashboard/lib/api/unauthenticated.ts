import type { ApiErrorCode } from "@llm-usage-lens/shared";

// The one 401 for a missing session (Data Model — "API Routes"; Rule 10.3,
// Rule 50.4), shared by the proxy (auth.ts `authorized`) and withRoute. It is
// not server-only and imports nothing from @/auth, so the proxy can use it.
const UNAUTHORIZED: ApiErrorCode = "UNAUTHORIZED";

export function unauthenticatedResponse(): Response {
  return Response.json(
    { error: { code: UNAUTHORIZED, message: "Not authenticated" } },
    { status: 401, headers: { "Cache-Control": "private, no-store" } },
  );
}
