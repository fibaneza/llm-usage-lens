import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { budgetResetPutItem } from "@/lib/data/budget-resets";
import { writeLiteLLMUserLink } from "@/lib/data/access/identity-links";
import {
  createPasswordUser,
  deletePasswordUser,
} from "@/lib/data/access/password-users";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { accounts, rollups } from "@/test/fixtures/scope-fixtures";
import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  testDoc,
} from "@/test/support/test-support";
import { nonAuditItems } from "@/test/support/governance-route-support";
import { listAuditRecords } from "@/lib/data/access/audit";

// Source: docs/specs/2026-05-15-design-system.md - "The user page (unit US2)":
// "Deleting is not erasing (user, 2026-11-18). Deleting a password user or
// removing a link leaves usage rollups, the budget-reset ledger, audit
// records and LiteLLM spend untouched" (D-US9). LiteLLM spend lives
// in LiteLLM: neither operation may call it (zero fetches).
vi.mock("@/auth", () => ({ auth: vi.fn() }));

beforeAll(ensureTestTable);

const SEED_DAY = "2026-01-02";
const OID = "00000000-0000-4000-8000-0000000000c1";
const LEDGER = {
  scope: "member" as const,
  resetId: "00000000-0000-4000-8000-000000000001",
  oid: OID,
  teamId: "team-a",
  departmentId: "dept-eng",
  litellmTeamId: "lt-team-a",
  litellmUserId: "lu-1",
  operation: "spend" as const,
  amount: 3.25,
  budget: 10 as number | null,
  trigger: "direct" as const,
  actorOid: "00000000-0000-4000-8000-0000000000a1",
  requestId: "req-ledger",
  timestamp: "2026-11-14T10:00:00.000Z",
};

// Identity-owned items an operation may legitimately change; everything else
// (rollups, the ledger, account metadata) must stay byte-identical.
const OWNED =
  /^(IDENT#|LOCALUSER#|USAGEKEY#|SSOEXPECT#|SSOREF#|SETUPLINK#|LITELLMUSER#)/;
const retained = async () =>
  (await nonAuditItems()).filter((i) => !OWNED.test(String(i.PK)));

const fetchSpy = vi.fn();
beforeEach(async () => {
  await clearTable();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  await loadFixtures({ accounts, rollups: rollups() });
  await testDoc().send(
    new TransactWriteCommand({ TransactItems: [budgetResetPutItem(LEDGER)] }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const seedCtx = (id: string) => ctxAt(new Date("2026-01-02T03:04:05.000Z"), id);

describe("deleting is not erasing (Design System - The user page, D-US9)", () => {
  it("deleting a password user leaves rollups, the ledger and earlier audit records as they were, and calls no LiteLLM", async () => {
    const created = ok(
      await createPasswordUser(
        { email: "pam@example.com", displayName: "Pam" },
        seedCtx("req-create"),
      ),
    );
    const before = await retained();
    const auditBefore = await listAuditRecords(SEED_DAY);
    expect(before.some((i) => String(i.PK).startsWith("BRESET#"))).toBe(true);
    expect(before.length).toBeGreaterThan(3);
    expect(auditBefore.length).toBeGreaterThan(0);

    ok(
      await deletePasswordUser(
        "pam@example.com",
        seedCtx("req-delete"),
        undefined,
        created.user.version,
      ),
    );

    expect(await retained()).toEqual(before);
    const auditAfter = await listAuditRecords(SEED_DAY);
    for (const record of auditBefore) expect(auditAfter).toContainEqual(record);
    expect(auditAfter.length).toBe(auditBefore.length + 1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("removing a LiteLLM link leaves rollups, the ledger and earlier audit records as they were, and calls no LiteLLM", async () => {
    ok(
      await writeLiteLLMUserLink(
        {
          oid: OID,
          version: null,
          write: {
            kind: "set",
            litellmUserId: "lu-1",
            mode: "manual",
            reason: "Same person, other email",
          },
        },
        seedCtx("req-link"),
      ),
    );
    const before = await retained();
    const auditBefore = await listAuditRecords(SEED_DAY);
    expect(before.some((i) => String(i.PK).startsWith("BRESET#"))).toBe(true);

    ok(
      await writeLiteLLMUserLink(
        { oid: OID, version: 1, write: { kind: "remove" } },
        seedCtx("req-unlink"),
      ),
    );

    expect(await retained()).toEqual(before);
    const auditAfter = await listAuditRecords(SEED_DAY);
    for (const record of auditBefore) expect(auditAfter).toContainEqual(record);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
