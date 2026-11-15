import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { GOVERNANCE_PK, ctxAt } from "@/lib/data/access/access-test-support";
import { resetDeniedAudit } from "@/lib/data/access/audit";
import {
  getPasswordSignIn,
  setPasswordSignIn,
} from "@/lib/data/access/password-users";
import { PER_USER_SK } from "@/lib/data/access/per-user-approval";
import {
  expectData,
  expectError,
  auditToday,
  deniedToday,
  invoke,
  nonAuditItems,
  signInAs,
} from "@/test/governance-route-support";
import { clearTable, ensureTestTable, putRaw } from "@/test/test-support";

import * as perUserRoute from "./governance/per-user-approval/route";
import {
  GET as getSignIn,
  PUT as putSignIn,
} from "./governance/password-sign-in/route";
import { GET as getApproval } from "./governance/per-user-approval/route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/governance/password-sign-in GET internal-admin or internal-auditor,
// PUT internal-admin; /api/governance/per-user-approval GET admin or auditor,
// PUT is a later slice), "Password users" D24 (the switch cannot be turned off
// while Entra is not configured: 409 CONFLICT), "Enforcement" items 2, 4, 6,
// "Audit log" (governance.passwordsignin.update: one success record; a 409 or
// 400 writes none; one `denied` record per authorization refusal, D17/T22),
// threat T28. Contract: temp/run-r4/contract-slice1.md.
// Only `@/auth` is mocked; "Entra configured" is the three
// AUTH_MICROSOFT_ENTRA_ID_* variables being set, read live (the `@/env` stand-in
// below is a live view of process.env so the suite does not depend on how the
// route reads it).
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/env", () => ({
  env: new Proxy({}, { get: (_t, key) => process.env[String(key)] }),
}));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const SIGN_IN = "/api/governance/password-sign-in";
const APPROVAL = "/api/governance/per-user-approval";

function configureEntra(on: boolean) {
  const vars = {
    AUTH_MICROSOFT_ENTRA_ID_ID: "client-id",
    AUTH_MICROSOFT_ENTRA_ID_SECRET: "client-secret",
    AUTH_MICROSOFT_ENTRA_ID_ISSUER:
      "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0",
  };
  for (const [name, value] of Object.entries(vars)) {
    if (on) vi.stubEnv(name, value);
    else vi.stubEnv(name, "");
  }
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  configureEntra(false);
  signInAs("admin");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/governance/password-sign-in", () => {
  it("401 without a session", async () => {
    signInAs(null);
    await expectError(
      await invoke(getSignIn, { method: "GET", path: SIGN_IN }),
      401,
      "UNAUTHORIZED",
    );
  });

  it.each(["viewer", "orgAdmin", "noRoles"] as const)(
    "403 FORBIDDEN for %s",
    async (caller) => {
      signInAs(caller);
      await expectError(
        await invoke(getSignIn, { method: "GET", path: SIGN_IN }),
        403,
        "FORBIDDEN",
      );
    },
  );

  it.each(["admin", "auditor"] as const)(
    "%s reads the default: enabled, version 0",
    async (caller) => {
      signInAs(caller);
      const data = await expectData(
        await invoke(getSignIn, { method: "GET", path: SIGN_IN }),
      );
      expect(data).toEqual({ enabled: true, version: 0 });
    },
  );

  it("reads the stored switch", async () => {
    configureEntra(true);
    await setPasswordSignIn({ enabled: false, entraConfigured: true }, ctxAt());
    signInAs("auditor");
    expect(
      await expectData(
        await invoke(getSignIn, { method: "GET", path: SIGN_IN }),
      ),
    ).toEqual({
      enabled: false,
      version: 1,
    });
  });
});

describe("PUT /api/governance/password-sign-in", () => {
  const put = (body: unknown, extra = {}) =>
    invoke(putSignIn, { method: "PUT", path: SIGN_IN, body, ...extra });

  it("turns the switch off when Entra is configured: new state returned, one governance.passwordsignin.update success record", async () => {
    configureEntra(true);
    const data = await expectData(await put({ enabled: false }));
    expect(data).toEqual({ enabled: false, version: 1 });
    expect(await getPasswordSignIn()).toEqual({ enabled: false, version: 1 });
    const records = await auditToday();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "governance.passwordsignin.update",
      result: "success",
      actor: "oid-admin",
    });
  });

  it("turns the switch back on, bumping the version", async () => {
    configureEntra(true);
    await expectData(await put({ enabled: false }));
    expect(await expectData(await put({ enabled: true }))).toEqual({
      enabled: true,
      version: 2,
    });
  });

  it("409 CONFLICT when turning it off while Entra is not configured (D24); state unchanged, nothing audited", async () => {
    await expectError(await put({ enabled: false }), 409, "CONFLICT");
    expect(await getPasswordSignIn()).toEqual({ enabled: true, version: 0 });
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it("turning it on while Entra is not configured is allowed", async () => {
    expect(await expectData(await put({ enabled: true }))).toMatchObject({
      enabled: true,
    });
  });

  it("401 without a session, nothing written", async () => {
    signInAs(null);
    configureEntra(true);
    await expectError(await put({ enabled: false }), 401, "UNAUTHORIZED");
    expect(await nonAuditItems()).toEqual([]);
  });

  it.each(["auditor", "orgAdmin", "viewer", "noRoles"] as const)(
    "%s: 403 before parsing and any read, state untouched, exactly one denied record",
    async (caller) => {
      configureEntra(true);
      signInAs(caller);
      for (const call of [
        { body: "{not json" },
        { body: {} },
        { contentType: "text/plain", body: { enabled: false } },
      ]) {
        resetDeniedAudit();
        await expectError(
          await invoke(putSignIn, { method: "PUT", path: SIGN_IN, ...call }),
          403,
          "FORBIDDEN",
        );
      }
      expect(await nonAuditItems()).toEqual([]);
      resetDeniedAudit();
      const audit0 = (await auditToday()).length;
      await expectError(await put({ enabled: false }), 403, "FORBIDDEN");
      expect(await auditToday()).toHaveLength(audit0 + 1);
      const denied = (await deniedToday()).at(-1);
      expect(denied).toMatchObject({
        action: "governance.passwordsignin.update",
        result: "denied",
        category: "security",
        code: "FORBIDDEN",
        route: { method: "PUT", pattern: "/api/governance/password-sign-in" },
      });
      expect(await getPasswordSignIn()).toEqual({ enabled: true, version: 0 });
    },
  );

  it("403 for an admin write with a missing or foreign Origin; state untouched", async () => {
    configureEntra(true);
    for (const origin of [null, "https://evil.example.test", "null"]) {
      await expectError(
        await put({ enabled: false }, { origin }),
        403,
        "FORBIDDEN",
      );
    }
    expect(await getPasswordSignIn()).toEqual({ enabled: true, version: 0 });
  });

  it.each([
    ["no Content-Type", { contentType: null, body: { enabled: false } }],
    ["text/plain", { contentType: "text/plain", body: { enabled: false } }],
    ["invalid JSON", { body: "{not json" }],
    ["an empty object", { body: {} }],
    ["a string flag", { body: { enabled: "false" } }],
    ["a null flag", { body: { enabled: null } }],
    ["a numeric flag", { body: { enabled: 0 } }],
  ])(
    "400 BAD_REQUEST for %s; state unchanged, no audit record of any kind",
    async (_name, call) => {
      configureEntra(true);
      await expectError(
        await invoke(putSignIn, { method: "PUT", path: SIGN_IN, ...call }),
        400,
        "BAD_REQUEST",
      );
      expect(await getPasswordSignIn()).toEqual({ enabled: true, version: 0 });
      expect(await auditToday()).toEqual([]);
    },
  );
});

describe("GET /api/governance/per-user-approval", () => {
  it("401 without a session", async () => {
    signInAs(null);
    await expectError(
      await invoke(getApproval, { method: "GET", path: APPROVAL }),
      401,
      "UNAUTHORIZED",
    );
  });

  it.each(["viewer", "orgAdmin", "noRoles"] as const)(
    "403 FORBIDDEN for %s",
    async (caller) => {
      signInAs(caller);
      await expectError(
        await invoke(getApproval, { method: "GET", path: APPROVAL }),
        403,
        "FORBIDDEN",
      );
    },
  );

  it.each(["admin", "auditor"] as const)(
    "%s sees { approved: false } when no approval was recorded (missing item is not an error)",
    async (caller) => {
      signInAs(caller);
      expect(
        await expectData(
          await invoke(getApproval, { method: "GET", path: APPROVAL }),
        ),
      ).toEqual({
        approved: false,
      });
    },
  );

  it.each(["admin", "auditor"] as const)(
    "%s sees the recorded approval",
    async (caller) => {
      await putRaw({
        PK: GOVERNANCE_PK,
        SK: PER_USER_SK,
        approvedBy: "oid-admin",
        approvedAt: "2026-11-01T00:00:00.000Z",
        reference: "WC-2026-14",
        version: 1,
      });
      signInAs(caller);
      expect(
        await expectData(
          await invoke(getApproval, { method: "GET", path: APPROVAL }),
        ),
      ).toEqual({
        approved: true,
        approvedBy: "oid-admin",
        approvedAt: "2026-11-01T00:00:00.000Z",
        reference: "WC-2026-14",
        version: 1,
      });
    },
  );

  it("is GET only in this slice: the setter (PUT) ships later", () => {
    expect(
      Object.keys(perUserRoute).filter((k) =>
        /^(POST|PUT|PATCH|DELETE)$/.test(k),
      ),
    ).toEqual([]);
  });
});
