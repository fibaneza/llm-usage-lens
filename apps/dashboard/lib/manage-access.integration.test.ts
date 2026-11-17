import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  seedOrg,
  signInAs,
  type CallerName,
} from "@/test/fixtures/scope-fixtures";
import { clearTable, ensureTestTable } from "@/test/support/test-support";

import { managementAccessFor } from "./manage-access";

// Source: slice B2 brief B2-1 (one server capability function:
// `managementAccessFor(session)` -> { global, team, organisation, users,
// audit: { app, gateway }, settings } from the stored roles and live scope;
// team = global reader or a live lead; organisation = users = settings =
// global reader; audit.app = the Access capability auditLog; audit.gateway =
// admin or auditor); Access Control - Navigation and landing by role (the
// matrix; Audit for org admin: neither source is readable by it); Rule 10.3 /
// 50.3. Security matrix, so every caller class is listed. Real policy inputs
// from DynamoDB Local (test/fixtures/scope-fixtures.ts org); only `@/auth` and
// the Next cache are stubbed. Edge cases (suspended scope, stored grants,
// fail closed) live in manage-access.test.ts.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.fakeNextCache;
});

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  await seedOrg();
});

type Flags = {
  global: boolean;
  team: boolean;
  organisation: boolean;
  users: boolean;
  appAudit: boolean;
  gatewayAudit: boolean;
  settings: boolean;
};

const READER = {
  global: true,
  team: true,
  organisation: true,
  users: true,
  settings: true,
};
const NOTHING: Flags = {
  global: false,
  team: false,
  organisation: false,
  users: false,
  appAudit: false,
  gatewayAudit: false,
  settings: false,
};

const MATRIX: readonly [CallerName, Flags][] = [
  ["admin", { ...READER, appAudit: true, gatewayAudit: true }],
  ["auditor", { ...READER, appAudit: true, gatewayAudit: true }],
  // The org admin reads neither audit source (Access Control, Audit for org admin).
  ["orgAdmin", { ...READER, appAudit: false, gatewayAudit: false }],
  // A lead gets Team only: no Organisation, Users, Audit or Settings.
  ["teamAdminA", { ...NOTHING, team: true }],
  ["deptAdminEng", { ...NOTHING, team: true }],
  ["memberA", NOTHING],
  ["memberB", NOTHING],
  ["viewerNone", NOTHING],
];

describe("managementAccessFor: the capability matrix (B2-1)", () => {
  it.each(MATRIX)("%s", async (name, expected) => {
    const { auth } = await import("@/auth");
    signInAs(name);
    const session = await (auth as unknown as () => Promise<never>)();

    const access = await managementAccessFor(session);

    expect(access).toEqual({
      global: expected.global,
      team: expected.team,
      organisation: expected.organisation,
      users: expected.users,
      audit: { app: expected.appAudit, gateway: expected.gatewayAudit },
      settings: expected.settings,
    });
  });

  it("no session reaches nothing", async () => {
    expect(await managementAccessFor(null)).toEqual({
      global: false,
      team: false,
      organisation: false,
      users: false,
      audit: { app: false, gateway: false },
      settings: false,
    });
  });
});
