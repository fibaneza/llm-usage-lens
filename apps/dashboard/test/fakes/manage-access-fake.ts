// Test-only stand-in for `@/lib/manage-access` (slice B2, B2-1) in page and
// layout tests that exercise something other than the capability function.
// The real function's per-caller matrix is asserted once, against DynamoDB
// Local, in lib/manage-access.integration.test.ts. Usage:
//
//   vi.mock("@/lib/manage-access", async () =>
//     (await import("@/test/fakes/manage-access-fake")).fakeManageAccess);
//
// The default is an admin: every flag true. Call `setManageAccess({...})` to
// narrow a case and `resetManageAccess()` in `afterEach`. Not imported by
// production code.
export type FakeManagementAccess = {
  global: boolean;
  team: boolean;
  organisation: boolean;
  users: boolean;
  audit: { app: boolean; gateway: boolean };
  settings: boolean;
};

const ADMIN: FakeManagementAccess = {
  global: true,
  team: true,
  organisation: true,
  users: true,
  audit: { app: true, gateway: true },
  settings: true,
};

let current: FakeManagementAccess = ADMIN;

export function setManageAccess(over: Partial<FakeManagementAccess>): void {
  current = { ...ADMIN, ...over };
}

export function resetManageAccess(): void {
  current = ADMIN;
}

export const fakeManageAccess = {
  managementAccessFor: async (): Promise<FakeManagementAccess> => current,
};
