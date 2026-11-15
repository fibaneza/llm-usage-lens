import {
  DateRangeQuerySchema,
  canonicalUsageIdentity,
  suggestIdentityLinks,
} from "@llm-usage-lens/shared";

import { cursorSecret } from "@/lib/api/access-route";
import { loadRangeRollups } from "@/lib/api/load-range-rollups";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { listIdentities } from "@/lib/data/access/identities";
import { getClaimedKeys } from "@/lib/data/access/identity-links";
import { getIdentityMapRules } from "@/lib/data/access/identity-map-rules";

// Source: docs/specs/2026-11-10-access-control.md - "Usage-identity mapping
// rules (D27)": suggest a link for each non-person usage key that a rule maps
// to an existing identity's email. Read-only: nothing is linked, claimed or
// audited; the admin confirms through PUT /api/identities/[oid]/links.
async function allIdentities() {
  const out: { oid: string; email?: string | undefined }[] = [];
  let cursor: string | undefined;
  do {
    const page = await listIdentities({
      cursorSecret: cursorSecret(),
      ...(cursor ? { cursor } : {}),
    });
    if (!page.ok) throw new Error(`identity listing failed: ${page.code}`);
    out.push(...page.value.items);
    cursor = page.value.cursor;
  } while (cursor);
  return out;
}

export const GET = withRoute(
  async (request) => {
    const { dateFrom, dateTo } = parseSearchParams(
      request,
      DateRangeQuerySchema,
    );
    const stored = await getIdentityMapRules();
    const rules = stored?.rules ?? [];
    if (rules.length === 0) return jsonData({ items: [] });

    const rollups = await loadRangeRollups(dateFrom, dateTo);
    const keys = new Set<string>();
    for (const rollup of rollups) {
      for (const model of Object.values(rollup.models)) {
        for (const key of Object.keys(model.byUser ?? {})) {
          if (canonicalUsageIdentity(key).kind === "non-person") keys.add(key);
        }
      }
    }

    const candidates = suggestIdentityLinks({
      rules,
      usageKeys: [...keys],
      identities: await allIdentities(),
      claimedKeys: [],
    });
    const claimed = new Set(
      await getClaimedKeys(candidates.map((c) => c.usageKey)),
    );
    return jsonData({
      items: candidates.filter((c) => !claimed.has(c.usageKey)),
    });
  },
  { requireAdminOrAuditor: true },
);
