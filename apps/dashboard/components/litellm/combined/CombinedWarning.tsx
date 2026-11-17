"use client";

import Link from "next/link";

import { useMe } from "@/hooks/useMe";
import { INTERNAL_ADMIN_ROLE } from "@/lib/auth/roles";

// LiteLLM spec -- Combined usage (L6), States: the text for every viewer; the
// Gateway sub-tab link only for an Admin (configuration writes are Admin-only,
// LD24). The roles come from GET /api/me; a failed read means no link.
export function CombinedWarning() {
  const me = useMe();
  const isAdmin = me.data?.roles.includes(INTERNAL_ADMIN_ROLE) ?? false;
  return (
    <div className="text-cell flex flex-wrap items-center gap-x-3">
      <p role="status">gateway not configured — totals may double count</p>
      {isAdmin ? (
        <Link
          href="/dashboard/settings/litellm/gateway"
          className="text-link underline-offset-4 hover:underline"
        >
          Configure the gateway
        </Link>
      ) : null}
    </div>
  );
}
