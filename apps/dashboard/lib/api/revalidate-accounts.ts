import "server-only";

import { revalidateTag } from "next/cache";

// Rule 60.10. Account writes change the cached account list (and the
// dept/team lookups built from it). Next 16 revalidateTag needs a profile;
// { expire: 0 } expires immediately so the next read is fresh (updateTag is
// Server-Action-only).
export function revalidateAccounts(): void {
  revalidateTag("accounts", { expire: 0 });
}
