"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { resolveSettingsHash } from "@/lib/settings-hash";
import type { SettingsTab } from "@/lib/settings-tabs";

// Source: Design System "Settings Page" - Hash compatibility (unit D,
// 2026-11-16): the step-up return URLs and old `#<slug>` links land on the
// right tab and section. The hash never reaches the server, so this runs after
// mount and replaces the URL only when the target route differs.
export function SettingsHashResolver({
  tabs,
}: {
  tabs: readonly SettingsTab[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const target = resolveSettingsHash(window.location.hash, tabs);
    if (target === null) return;
    if (target.split("#")[0] === pathname) return;
    router.replace(target);
  }, [tabs, pathname, router]);

  return null;
}
