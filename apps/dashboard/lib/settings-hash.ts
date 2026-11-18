import { LITELLM_AREA_HREF } from "@/lib/nav";
import type { SettingsTab } from "@/lib/settings-tabs";

// Source: Design System "Settings Page" - Hash compatibility (unit D,
// 2026-11-16). Maps an old `#<section-slug>` to `<route>#<slug>` over the tabs
// the caller can see; null for an unknown slug or one the caller cannot use.
// M1 (Design System - Routes and redirects, 2026-11-18): Team links and Users
// moved to the LiteLLM area; a caller who may not see the target gets its 404
// there. Paths are root-relative: router.replace adds the base path.
const MOVED_HASH_TARGETS: ReadonlyMap<string, string> = new Map([
  ["team-links", `${LITELLM_AREA_HREF}/teams`],
  ["users", `${LITELLM_AREA_HREF}/users`],
]);

export function resolveSettingsHash(
  hash: string,
  tabs: readonly SettingsTab[],
): string | null {
  const slug = hash.startsWith("#") ? hash.slice(1) : hash;
  if (slug === "") return null;
  const moved = MOVED_HASH_TARGETS.get(slug);
  if (moved !== undefined) return moved;
  const litellm = tabs
    .find((t) => t.id === "litellm")
    ?.subTabs.find((s) => s.id === slug);
  if (litellm) return litellm.href;
  const groups = tabs.flatMap((t) => [
    { href: t.href, sections: t.sections },
    ...t.subTabs,
  ]);
  const group = groups.find((g) => g.sections.some((s) => s === slug));
  return group ? `${group.href}#${slug}` : null;
}
