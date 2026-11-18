import { describe, expect, it, vi } from "vitest";

import {
  CALLERS,
  createRequest,
  listRequests,
  seedSeenRoles,
  setupBudgetResetSuite,
} from "@/test/support/budget-reset-support";
import { putRaw } from "@/test/support/test-support";

// Sources: review m4-r1 Q-W2 (coordinator decision, 2026-11-18): in `prod`,
// before the per-user approval, GET /api/budget-reset-requests shows the
// requester's name, email and reason only to the deciders of that team (a
// Lead in scope, org-admin, admin), who need them to decide (MG-D12); the
// auditor sees only counts until the approval, like MG-D10. Access Control -
// "Visibility and inheritance" (the per-user approval gate, GOVERNANCE/PER_USER)
// and BR10. Mirrors budget-resets/route.prod-gate.integration.test.ts.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});
vi.mock("@/env", async (orig) => {
  const actual = await orig<typeof import("@/env")>();
  return {
    env: new Proxy(actual.env, {
      get: (target, prop, receiver) =>
        prop === "APP_ENV" ? "prod" : Reflect.get(target, prop, receiver),
    }),
  };
});

setupBudgetResetSuite();

const REASON = "UNIQUE-PROD-REASON-5521";
const personal = (who: keyof typeof CALLERS) => [CALLERS[who].email, REASON];

const requestFromMemberA = async () => {
  await seedSeenRoles(CALLERS.memberA.oid, CALLERS.memberA.email, []);
  const made = await createRequest("memberA", REASON);
  expect(made.status).toBe(201);
  return made;
};

describe("GET /api/budget-reset-requests in prod without the per-user approval (review m4-r1 Q-W2; MG-D12, BR10)", () => {
  it.each(["admin", "orgAdmin", "teamAdminA", "deptAdminEng"] as const)(
    "%s (a decider of the team) sees the requester's name, email and reason",
    async (who) => {
      await requestFromMemberA();
      const { status, body } = await listRequests(who, "team-a");
      expect(status).toBe(200);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]).toMatchObject({
        reason: REASON,
        requester: {
          oid: CALLERS.memberA.oid,
          email: CALLERS.memberA.email,
        },
      });
      expect(body.data.items[0].requester.displayName).toBeTruthy();
    },
  );

  it("the auditor is answered 200 with counts only: no name, email, reason or requester oid anywhere in the body", async () => {
    await requestFromMemberA();
    const { status, text } = await listRequests("auditor", "team-a");
    expect(status).toBe(200);
    for (const secret of [...personal("memberA"), CALLERS.memberA.oid]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("the auditor's answer still carries the number of open requests (counts are not hidden)", async () => {
    await requestFromMemberA();
    const { body } = await listRequests("auditor", "team-a");
    const items = body.data.items ?? [];
    const count = body.data.count ?? items.length;
    expect(count).toBe(1);
  });

  it("the auditor also gets no personal data from status=all", async () => {
    await requestFromMemberA();
    const { status, text } = await listRequests("auditor", "team-a", "all");
    expect(status).toBe(200);
    for (const secret of [...personal("memberA"), CALLERS.memberA.oid]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("once the per-user approval is recorded the auditor sees names, email and reason", async () => {
    await requestFromMemberA();
    await putRaw({
      PK: "GOVERNANCE",
      SK: "PER_USER",
      approvedBy: CALLERS.admin.oid,
      approvedAt: "2026-11-14T10:00:00.000Z",
      reference: "works-council-1",
      version: 1,
    });
    const { status, body } = await listRequests("auditor", "team-a");
    expect(status).toBe(200);
    expect(body.data.items[0]).toMatchObject({
      reason: REASON,
      requester: { email: CALLERS.memberA.email },
    });
  });
});
