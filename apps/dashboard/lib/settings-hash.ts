import type { SettingsTab } from "@/lib/settings-tabs";

// Source: Design System "Settings Page" - Hash compatibility (unit D,
// 2026-11-16). Maps an old `#<section-slug>` to `<route>#<slug>` over the tabs
// the caller can see; null for an unknown slug or one the caller cannot use.
export function resolveSettingsHash(
  hash: string,
  tabs: readonly SettingsTab[],
): string | null {
  const slug = hash.startsWith("#") ? hash.slice(1) : hash;
  if (slug === "") return null;
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
