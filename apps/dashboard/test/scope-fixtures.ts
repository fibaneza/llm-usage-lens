// Test-only org fixture shared by the 4R.3 scoping suites (not imported by
// production code). Two departments, four teams; team-m moves from dept-eng to
// dept-ops on the third day (Access Control spec - W3).
import { vi } from "vitest";

import { auth } from "@/auth";
import { ctxAt, ok } from "@/lib/data/access/access-test-support";
import { grantAdminScope } from "@/lib/data/access/admin-scopes";
import { addMember } from "@/lib/data/access/affiliations";
import { buildRollup } from "@/test/rollup-builder";
import { loadFixtures, makeAccount } from "@/test/test-support";

export const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-03";

const eng = { departmentId: "dept-eng", departmentName: "Engineering" };
const ops = { departmentId: "dept-ops", departmentName: "Ops" };
export const accounts = [
  makeAccount(1, { teamId: "team-a", teamName: "A", ...eng }),
  makeAccount(2, { teamId: "team-b", teamName: "B", ...eng }),
  makeAccount(3, { teamId: "team-c", teamName: "C", ...ops }),
  makeAccount(4, { teamId: "team-m", teamName: "M", ...ops }),
];

export function rollups() {
  return ["2026-10-01", "2026-10-02", "2026-10-03"].flatMap((date, i) => {
    const row = (
      n: number,
      teamId: string,
      dept: typeof eng,
      users: Record<string, number>,
    ) =>
      buildRollup({
        date,
        accountId: accounts[n]!.accountId,
        teamId,
        teamName: teamId.slice(-1).toUpperCase(),
        ...dept,
        models: {
          "claude-sonnet": {
            cost: Object.values(users).reduce((a, b) => a + b, 0),
            byUser: users,
          },
        },
      });
    return [
      row(0, "team-a", eng, { "a1@company.com": 7, "a2@company.com": 4 }),
      row(1, "team-b", eng, { "b1@company.com": 23 }),
      row(2, "team-c", ops, { "c1@company.com": 41 }),
      row(3, "team-m", i < 2 ? eng : ops, { "m1@company.com": 5 }),
    ];
  });
}

const oid = (n: number) => `00000000-0000-4000-8000-0000000001${n}0`;
export const CALLERS = {
  viewerNone: {
    oid: oid(1),
    email: "v0@company.com",
    roles: ["internal-viewer"],
  },
  memberA: { oid: oid(2), email: "a1@company.com", roles: ["internal-viewer"] },
  memberB: { oid: oid(3), email: "b1@company.com", roles: ["internal-viewer"] },
  teamAdminA: {
    oid: oid(4),
    email: "ta@company.com",
    roles: ["internal-viewer"],
  },
  deptAdminEng: {
    oid: oid(5),
    email: "da@company.com",
    roles: ["internal-viewer"],
  },
  orgAdmin: {
    oid: oid(6),
    email: "oa@company.com",
    roles: ["internal-org-admin"],
  },
  auditor: {
    oid: oid(7),
    email: "au@company.com",
    roles: ["internal-auditor"],
  },
  admin: { oid: oid(8), email: "ad@company.com", roles: ["internal-admin"] },
} as const;
export type CallerName = keyof typeof CALLERS;

export function signInAs(name: CallerName | null, email?: string) {
  const mock = auth as unknown as ReturnType<typeof vi.fn>;
  if (name === null) return mock.mockResolvedValue(null);
  const c = CALLERS[name];
  return mock.mockResolvedValue({
    user: {
      oid: c.oid,
      email: email ?? c.email,
      roles: [...c.roles],
      tid: "t",
      authMethod: "entra",
    },
  });
}

type Handler = (
  request: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export async function get(handler: unknown, path: string, id?: string) {
  const params: Record<string, string> = id === undefined ? {} : { id };
  const res = await (handler as Handler)(
    new Request(`http://localhost${path}`),
    { params: Promise.resolve(params) },
  );
  return {
    res,
    body: (await res.json()) as { data?: unknown; error?: unknown },
  };
}

export function numbersIn(
  value: unknown,
  out = new Set<number>(),
): Set<number> {
  if (typeof value === "number") out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => numbersIn(v, out));
  }
  return out;
}

export async function seedOrg(): Promise<void> {
  await loadFixtures({ accounts, rollups: rollups() });
  const ctx = ctxAt(undefined, "req-seed");
  ok(await addMember({ oid: CALLERS.memberA.oid, teamId: "team-a" }, ctx));
  ok(await addMember({ oid: CALLERS.memberB.oid, teamId: "team-b" }, ctx));
  ok(
    await grantAdminScope(
      { oid: CALLERS.teamAdminA.oid, scopeType: "team", scopeId: "team-a" },
      ctx,
    ),
  );
  ok(
    await grantAdminScope(
      {
        oid: CALLERS.deptAdminEng.oid,
        scopeType: "department",
        scopeId: "dept-eng",
      },
      ctx,
    ),
  );
}
