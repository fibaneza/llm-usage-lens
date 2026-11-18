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
// section, else null. The slugs are the ten Settings `AccessSection` ids that
// existed before the split (components/settings/access/AccessSections.tsx).
const BASE = "/dashboard/settings";
const MANAGE_LITELLM = "/dashboard/manage/litellm";

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
];

describe("resolveSettingsHash", () => {
  // B2-3: the audit slugs left Settings with the Audit tab (they live on
  // Management -> Audit, a different route); a stale link resolves to nothing.
  it.each(["#audit-log", "#access-review"])(
    "%s no longer resolves in Settings, even for an admin",
    (hash) => {
      expect(resolveSettingsHash(hash, settingsTabsFor(ADMIN))).toBeNull();
    },
  );

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

// Unit A2. Source: Design System "Settings Page" - LiteLLM sub-tabs (D-A2-4):
// an old `#<connection|guardrails>` link lands on the matching
// LiteLLM route. The target is the bare route (no fragment): the route has no
// anchor of that name.
describe("resolveSettingsHash - LiteLLM sub-tabs (unit A2)", () => {
  it.each([
    ["connection", `${BASE}/litellm/connection`],
    ["guardrails", `${BASE}/litellm/guardrails`],
  ])(
    "#%s lands on its LiteLLM route for the three LiteLLM roles",
    (slug, route) => {
      for (const viewer of [ADMIN, ORG_ADMIN, AUDITOR]) {
        expect(resolveSettingsHash(`#${slug}`, settingsTabsFor(viewer))).toBe(
          route,
        );
      }
    },
  );

  // M1 (Design System - Routes and redirects, "Old hash links", 2026-11-18,
  // line 390): Team links and Users left Settings, so their old `#slug` links
  // land on the Management LiteLLM route instead of being ignored. The target
  // is the bare route (no fragment), as for the LiteLLM sub-tabs above. A
  // caller who may not see the target gets its missing-page 404 there, not a
  // null from this resolver; every caller with Settings can see both targets
  // (Access Control - Navigation and landing by role, Management - LiteLLM).
  it.each([
    ["team-links", `${MANAGE_LITELLM}/teams`],
    ["users", `${MANAGE_LITELLM}/users`],
  ])("#%s lands on %s for the three Settings roles", (slug, route) => {
    for (const viewer of [ADMIN, ORG_ADMIN, AUDITOR]) {
      expect(resolveSettingsHash(`#${slug}`, settingsTabsFor(viewer))).toBe(
        route,
      );
    }
  });

  it("returns null for a LiteLLM slug when the caller has no LiteLLM tab", () => {
    expect(
      resolveSettingsHash("#guardrails", settingsTabsFor(PLAIN_VIEWER)),
    ).toBeNull();
  });
});
