import "server-only";

import { env } from "@/env";

// "SSO enabled" means the Entra client id is set (LiteLLM spec - LW1). The one
// place that answers it; read per call so a changed environment is honoured.
export function isSsoEnabled(): boolean {
  return Boolean(env.AUTH_MICROSOFT_ENTRA_ID_ID);
}
