import { describe, expect, it } from "vitest";

import {
  ADMIN,
  AUDITOR,
  ORG_ADMIN,
  PLAIN_VIEWER,
} from "@/test/fixtures/access-viewers";

import { resolveSettingsHash } from "./settings-hash";
import { settingsTabsFor } from "./settings-tabs";

// Source: Design System "Settings Page" - Hash compatibility (unit D,
// 2026-11-16); Access Control "Recent authentication" (step-up returns the final tab URLs
// `/dashboard/settings/access/roles#role-grants` and
// `/dashboard/settings/access/sign-in#password-users`; D33a). Module under
// test: `lib/settings-hash.ts`
//   resolveSettingsHash(hash: string, tabs: readonly SettingsTab[]): string | null
// maps an old section slug (with or without the leading '#') to
// `<route>#<slug>` when the caller's visible `tabs` include that route and
// section, else null. The slugs are the twelve `AccessSection` ids that
// existed before the split (components/settings/access/AccessSections.tsx).
const BASE = "/dashboard/settings";

const OLD_SLUGS: [string, string][] = [
  ["members", `${BASE}/access/people`],
  ["team-admins", `${BASE}/access/people`],
  ["pending-access", `${BASE}/access/people`],
  ["visibility", `${BASE}/access/visibility`],
  ["group-mappings", `${BASE}/access/roles`],
  ["role-grants", `${BASE}/access/roles`],
  ["identity-links", `${BASE}/access/identities`],
  ["identity-mapping", `${BASE}/access/identities`],
  ["password-users", `${BASE}/access/sign-in`],
  ["per-user-approval", `${BASE}/access/sign-in`],
  ["audit-log", `${BASE}/audit`],
  ["access-review", `${BASE}/audit`],
];

describe("resolveSettingsHash", () => {
  it.each(OLD_SLUGS)("#%s lands on its tab and sub-tab", (slug, route) => {
    expect(resolveSettingsHash(`#${slug}`, settingsTabsFor(ADMIN))).toBe(
      `${route}#${slug}`,
    );
  });

  it("accepts the hash with or without '#'", () => {
    const tabs = settingsTabsFor(ADMIN);
    expect(resolveSettingsHash("role-grants", tabs)).toBe(
      resolveSettingsHash("#role-grants", tabs),
    );
  });

  it("maps the two step-up return URLs (Recent authentication, D33)", () => {
    const tabs = settingsTabsFor(ADMIN);
    expect(resolveSettingsHash("#role-grants", tabs)).toBe(
      `${BASE}/access/roles#role-grants`,
    );
    expect(resolveSettingsHash("#password-users", tabs)).toBe(
      `${BASE}/access/sign-in#password-users`,
    );
  });

  it.each(["", "#", "#nope", "#constructor", "#__proto__", "#toString"])(
    "returns null for the unknown hash %j",
    (hash) => {
      expect(resolveSettingsHash(hash, settingsTabsFor(ADMIN))).toBeNull();
    },
  );

  it("ignores a slug whose tab the caller cannot use", () => {
    expect(
      resolveSettingsHash("#role-grants", settingsTabsFor(ORG_ADMIN)),
    ).toBeNull();
    expect(
      resolveSettingsHash("#audit-log", settingsTabsFor(ORG_ADMIN)),
    ).toBeNull();
    expect(
      resolveSettingsHash("#members", settingsTabsFor(PLAIN_VIEWER)),
    ).toBeNull();
  });

  it("ignores a slug whose section the caller cannot use inside a sub-tab they can", () => {
    // The auditor has People, with Pending and stale access only (D34).
    const tabs = settingsTabsFor(AUDITOR);
    expect(resolveSettingsHash("#members", tabs)).toBeNull();
    expect(resolveSettingsHash("#pending-access", tabs)).toBe(
      `${BASE}/access/people#pending-access`,
    );
  });
});
