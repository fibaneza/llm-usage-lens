import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getDocumentClient } from "@/lib/dynamodb";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  putRaw,
  testDoc,
} from "@/test/test-support";

import { resolveDevIdentity } from "./dev-identity";

// Source: docs/specs/2026-11-10-access-control.md - "Dev login" (L3c, amended
// L3c2, user, 2026-11-16): an optional identity (an email or a dashboard oid);
// a stored identity signs in as itself with its stored lastSeenRoles as the
// role claim (`identity.roles`); an unknown email or oid is refused; the empty
// identity is the Local Developer with no stored roles (the form decides).
// Threat T7 / LT21 (the env rejection) is covered by pre-sso.test.ts and
// auth-config.test.ts.
// Rule 60.22: DynamoDB Local, no mocks of the data layer.
//
// Ruled (tdd-test-engineer): undefined and "" are the empty identity; any
// other non-string is refused; surrounding whitespace is not asserted.
const LOCAL = {
  oid: "local:dev@localhost",
  email: "dev@localhost",
  name: "Local Developer",
};
const STORED_OID = "00000000-0000-4000-8000-0000000000a1";
const STORED = {
  PK: `IDENT#${STORED_OID}`,
  SK: "META",
  gsi1pk: "IDENTS",
  gsi1sk: `IDENT#${STORED_OID}`,
  oid: STORED_OID,
  tid: "00000000-0000-4000-8000-0000000000b1",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  lastSignInAt: "2026-11-10T10:00:00.000Z",
  lastSeenRoles: ["internal-auditor"],
  authMethod: "entra",
  version: 3,
};

async function stored(oid: string) {
  const r = await testDoc().send(
    new GetCommand({
      TableName: TEST_TABLE_NAME,
      Key: { PK: `IDENT#${oid}`, SK: "META" },
    }),
  );
  return r.Item;
}

function identityOf(out: Awaited<ReturnType<typeof resolveDevIdentity>>): {
  oid: string;
  email?: string;
  name: string;
  roles?: string[];
} {
  if (!out.ok) throw new Error("expected a resolved identity");
  return out.identity;
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  await putRaw(STORED);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveDevIdentity", () => {
  it.each([undefined, ""])(
    "the empty identity %j is today's local developer (Dev login)",
    async (input) => {
      expect(identityOf(await resolveDevIdentity(input))).toEqual(LOCAL);
    },
  );

  it.each(["ada@example.com", "Ada@Example.COM"])(
    "a stored email %s signs in as that identity, case-insensitively (Dev login)",
    async (input) => {
      expect(identityOf(await resolveDevIdentity(input))).toEqual({
        oid: STORED_OID,
        email: "ada@example.com",
        name: "Ada Lovelace",
        roles: ["internal-auditor"],
      });
    },
  );

  it("a stored oid signs in as that identity (Dev login)", async () => {
    expect(identityOf(await resolveDevIdentity(STORED_OID))).toEqual({
      oid: STORED_OID,
      email: "ada@example.com",
      name: "Ada Lovelace",
      roles: ["internal-auditor"],
    });
  });

  it("finds a stored email beyond the first page of results (Rule 20.6, Dev login)", async () => {
    const pad = "x".repeat(8_000);
    const late = "ffffffff-0000-4000-8000-00000000ffff";
    const rows = Array.from({ length: 200 }, (_, i) => {
      const oid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      return {
        ...STORED,
        PK: `IDENT#${oid}`,
        gsi1sk: `IDENT#${oid}`,
        oid,
        email: `pad${i}@example.com`,
        displayName: pad,
      };
    });
    rows.push({
      ...STORED,
      PK: `IDENT#${late}`,
      gsi1sk: `IDENT#${late}`,
      oid: late,
      email: "late@example.com",
      displayName: "Late Person",
    });
    for (let i = 0; i < rows.length; i += 25) {
      await Promise.all(rows.slice(i, i + 25).map(putRaw));
    }
    expect(
      identityOf(await resolveDevIdentity("late@example.com")),
    ).toMatchObject({ oid: late, name: "Late Person" });
  });

  // Dev login (amended L3c2): "an identity that is not stored (unknown email or
  // unknown oid) is refused with the one generic failure"; no dev- identity.
  it.each(["new.person@example.com", "New.Person@Example.com"])(
    "an unknown email %s is refused, not minted as a dev- identity (Dev login, L3c2)",
    async (input) => {
      expect(await resolveDevIdentity(input)).toEqual({ ok: false });
    },
  );

  it("an unknown oid is refused (Dev login, L3c2)", async () => {
    expect(
      await resolveDevIdentity("11111111-1111-4111-8111-111111111111"),
    ).toEqual({ ok: false });
  });

  it("the empty identity carries no stored roles, so the form role decides (Dev login, L3c2)", async () => {
    const identity = identityOf(await resolveDevIdentity(""));
    expect(identity.roles).toBeUndefined();
  });

  // Dev login (amended L3c2): the role claim is the stored lastSeenRoles
  // filtered to valid global roles; absent or empty gets the password-user
  // baseline resolveGlobalRoles(undefined) = ["internal-viewer"] (roles.ts).
  it.each([
    ["two valid roles", ["internal-viewer", "internal-admin"]],
    [
      "valid roles beside junk and the legacy Admin alias",
      ["internal-viewer", "internal-admin", "Admin", "bogus"],
    ],
  ])(
    "takes the stored lastSeenRoles, filtered to global roles: %s (Dev login, L3c2)",
    async (_label, lastSeenRoles) => {
      await putRaw({ ...STORED, lastSeenRoles });
      const roles = identityOf(
        await resolveDevIdentity("ada@example.com"),
      ).roles;
      expect([...(roles ?? [])].sort()).toEqual([
        "internal-admin",
        "internal-viewer",
      ]);
    },
  );

  it.each([
    ["an empty claim", { lastSeenRoles: [] }],
    ["only invalid entries", { lastSeenRoles: ["Admin", "bogus"] }],
    ["an absent claim", { lastSeenRoles: undefined }],
  ])(
    "falls back to the password-user baseline internal-viewer for %s (Dev login, L3c2)",
    async (_label, over) => {
      await putRaw({ ...STORED, ...over });
      expect(identityOf(await resolveDevIdentity(STORED_OID)).roles).toEqual([
        "internal-viewer",
      ]);
    },
  );

  it("returns the stored role claim, not an elevated one, by email and by oid alike (Dev login, L3c2)", async () => {
    const byEmail = identityOf(await resolveDevIdentity("ada@example.com"));
    const byOid = identityOf(await resolveDevIdentity(STORED_OID));
    expect(byEmail.roles).toEqual(["internal-auditor"]);
    expect(byOid.roles).toEqual(["internal-auditor"]);
  });

  it.each([
    ["a control character", "ada@exa\u0000mple.com"],
    ["a newline", "ada@example.com\nx"],
    ["a tab", "ada@exa\tmple.com"],
    ["an email over the length cap", `${"a".repeat(260)}@example.com`],
    ["a token over the length cap", "z".repeat(300)],
    ["a number", 42],
    ["an object", { email: "ada@example.com" }],
    ["an array", ["ada@example.com"]],
    ["a boolean", true],
  ])(
    "refuses %s before any DynamoDB read (Dev login, T7 input validation)",
    async (_label, input) => {
      const send = vi.spyOn(getDocumentClient(), "send");
      expect(await resolveDevIdentity(input)).toEqual({ ok: false });
      expect(send).not.toHaveBeenCalled();
    },
  );

  // Access Control - Dev login / master user (Rule 50): the master user's oid
  // is `master:<username>` (lib/auth/master-user.ts); the dev login must never
  // mint a session as it. Refused before any DynamoDB read.
  it.each(["master:root", "MASTER:Root", "master:"])(
    "refuses the master-prefixed oid %j before any DynamoDB read (Rule 50, Dev login)",
    async (input) => {
      const send = vi.spyOn(getDocumentClient(), "send");
      expect(await resolveDevIdentity(input)).toEqual({ ok: false });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("still resolves a non-master oid that merely contains a colon (Dev login)", async () => {
    const colon = "local:someone";
    await putRaw({
      ...STORED,
      PK: `IDENT#${colon}`,
      gsi1sk: `IDENT#${colon}`,
      oid: colon,
    });
    expect(identityOf(await resolveDevIdentity(colon))).toMatchObject({
      oid: colon,
    });
  });

  it("refuses a well-formed token that is not a stored oid (Dev login)", async () => {
    expect(await resolveDevIdentity("no-such-oid")).toEqual({ ok: false });
  });
});

// Dev login: "a given identity that exists in DynamoDB signs in as that
// identity". The signIn callback's upsertIdentity must not turn the stored
// record into a dev record (authMethod, tid, lastSeenRoles). Lowest layer that
// sees it: the real authorize + signIn callback over DynamoDB Local.
describe("dev sign-in as a stored identity leaves the stored record's provenance", () => {
  type Rec = Record<string, unknown>;
  type Config = {
    providers: {
      options?: { id?: string; authorize: (c: unknown) => Promise<Rec | null> };
    }[];
    callbacks: { signIn: (arg: Rec) => Promise<boolean> };
  };
  const captured = { config: undefined as unknown as Config };

  async function devSignIn(credentials: Rec): Promise<boolean> {
    vi.doMock("next-auth", () => ({
      default: (config: unknown) => {
        captured.config = config as Config;
        return {
          handlers: {},
          auth: vi.fn(),
          signIn: vi.fn(),
          signOut: vi.fn(),
        };
      },
    }));
    vi.doMock("next-auth/providers/credentials", () => ({
      default: (options: unknown) => ({ type: "credentials", options }),
    }));
    vi.doMock("next-auth/providers/microsoft-entra-id", () => ({
      default: { type: "oidc", id: "microsoft-entra-id" },
    }));
    const vars: Record<string, string> = {
      SKIP_ENV_VALIDATION: "1",
      AUTH_SECRET: "test-secret",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PHASE: "",
      NODE_ENV: "development",
      APP_ENV: "dev",
      AUTH_DEV_LOGIN: "true",
      AUTH_MICROSOFT_ENTRA_ID_ID: "",
      AUTH_MICROSOFT_ENTRA_ID_SECRET: "",
      AUTH_MICROSOFT_ENTRA_ID_ISSUER: "",
      AUTH_MASTER_USERNAME: "",
    };
    for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
    vi.stubGlobal("window", undefined);
    vi.resetModules();
    await import("@/auth");
    const provider = captured.config.providers.find(
      (p) => p.options?.id === "dev-login",
    );
    const user = await provider?.options?.authorize(credentials);
    if (!user) throw new Error("dev-login refused the credentials");
    return captured.config.callbacks.signIn({
      user,
      account: { provider: "dev-login" },
    });
  }

  afterEach(() => {
    vi.doUnmock("next-auth");
    vi.doUnmock("next-auth/providers/credentials");
    vi.doUnmock("next-auth/providers/microsoft-entra-id");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps the stored authMethod, tid and lastSeenRoles (Dev login)", async () => {
    const ok = await devSignIn({
      role: "internal-viewer",
      identity: "Ada@Example.com",
    });
    expect(ok).toBe(true);
    expect(await stored(STORED_OID)).toMatchObject({
      oid: STORED_OID,
      authMethod: "entra",
      tid: STORED.tid,
      lastSeenRoles: ["internal-auditor"],
      email: "ada@example.com",
      displayName: "Ada Lovelace",
    });
    // "only lastSignInAt moves" (Dev login, amended L3c2)
    expect((await stored(STORED_OID))?.lastSignInAt).not.toBe(
      STORED.lastSignInAt,
    );
  });

  it("keeps a stored password user's provenance and roles too, whatever role is posted (Dev login, L3c2)", async () => {
    await putRaw({
      ...STORED,
      authMethod: "password",
      lastSeenRoles: ["internal-org-admin"],
    });
    const ok = await devSignIn({
      role: "internal-viewer",
      identity: STORED_OID,
    });
    expect(ok).toBe(true);
    expect(await stored(STORED_OID)).toMatchObject({
      authMethod: "password",
      tid: STORED.tid,
      lastSeenRoles: ["internal-org-admin"],
    });
  });
});
