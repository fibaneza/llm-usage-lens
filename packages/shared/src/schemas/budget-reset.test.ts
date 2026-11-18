import { describe, expect, it } from "vitest";

import {
  BUDGET_RESET_TRIGGERS,
  BudgetResetCountsQuerySchema,
  BudgetResetCountsSchema,
  BudgetResetReasonSchema,
  BudgetResetSchema,
  CreateBudgetResetRequestInputSchema,
  MarkNotificationsReadInputSchema,
  NotificationIdSchema,
  NotificationKindSchema,
} from "../index";

// Sources: docs/specs/2026-05-15-data-model.md -- "Budget reset entities (unit
// M4)" (reason: optional, plain text, 1-280 characters after trimming; C0
// control characters except line feed, and U+007F, rejected; the team is never
// a body field; BudgetReset fields; Notification id is the SK) and "API Routes"
// (`MarkNotificationsReadInputSchema`: `{ ids: string[1..50] }` or `{ all:
// true }`; `BudgetResetCountsQuerySchema` = DateRangeQuerySchema + optional
// teamId); Access Control BR7; Rule 20.8 (90-day cap); Rule 60.22 (valid and
// invalid cases).
const UUID = "11111111-1111-4111-8111-111111111111";
const NID = `2026-11-14T09:00:00.000Z#${UUID}`;

describe("BudgetResetReasonSchema (BR7)", () => {
  it.each([
    ["one character", "x"],
    ["exactly 280 characters", "x".repeat(280)],
    ["a line feed inside", "line one\nline two"],
    ["markup kept as literal text", "<b>hi</b> & 'quotes'"],
    ["non-ASCII text", "Ünïcödé 日本語"],
  ])("accepts %s", (_n, value) => {
    expect(BudgetResetReasonSchema.safeParse(value).success).toBe(true);
  });

  it("trims the edges", () => {
    expect(BudgetResetReasonSchema.parse("  hello \n")).toBe("hello");
  });

  it.each([
    ["empty", ""],
    ["only whitespace", "   "],
    ["281 characters", "x".repeat(281)],
    ["a NUL", "a\u0000b"],
    ["a tab", "a\tb"],
    ["a carriage return", "a\rb"],
    ["an escape", "a\u001bb"],
    ["DEL", "a\u007fb"],
    ["not a string", 42],
  ])("rejects %s", (_n, value) => {
    expect(BudgetResetReasonSchema.safeParse(value).success).toBe(false);
  });
});

describe("CreateBudgetResetRequestInputSchema", () => {
  it("accepts an empty body (the reason is optional)", () => {
    expect(CreateBudgetResetRequestInputSchema.safeParse({}).success).toBe(
      true,
    );
  });

  it.each([
    ["teamId", { teamId: "team-a" }],
    ["requesterOid", { requesterOid: "oid-x" }],
    ["status", { status: "approved" }],
  ])(
    "rejects a %s field: the team and the requester come from the session",
    (_n, extra) => {
      expect(
        CreateBudgetResetRequestInputSchema.safeParse({
          reason: "ok",
          ...extra,
        }).success,
      ).toBe(false);
    },
  );
});

describe("MarkNotificationsReadInputSchema", () => {
  it("accepts 1 to 50 ids", () => {
    expect(
      MarkNotificationsReadInputSchema.safeParse({ ids: [NID] }).success,
    ).toBe(true);
    expect(
      MarkNotificationsReadInputSchema.safeParse({
        ids: Array.from({ length: 50 }, () => NID),
      }).success,
    ).toBe(true);
  });

  it("accepts { all: true }", () => {
    expect(
      MarkNotificationsReadInputSchema.safeParse({ all: true }).success,
    ).toBe(true);
  });

  it.each([
    ["no ids", { ids: [] }],
    ["51 ids", { ids: Array.from({ length: 51 }, () => NID) }],
    ["an id that is not {createdAt}#{uuid}", { ids: ["NOTIF#oid-b"] }],
    ["a bare uuid", { ids: [UUID] }],
    ["all: false", { all: false }],
    ["ids and all together", { ids: [NID], all: true }],
    ["an empty body", {}],
    ["a recipient field", { ids: [NID], recipientOid: "oid-b" }],
  ])("rejects %s", (_n, body) => {
    expect(MarkNotificationsReadInputSchema.safeParse(body).success).toBe(
      false,
    );
  });
});

describe("NotificationIdSchema and kinds", () => {
  it("accepts the sort key shape and rejects a key that could address another partition", () => {
    expect(NotificationIdSchema.safeParse(NID).success).toBe(true);
    expect(NotificationIdSchema.safeParse(`NOTIF#oid-b#${NID}`).success).toBe(
      false,
    );
    expect(NotificationIdSchema.safeParse(`${NID}\n`).success).toBe(false);
  });

  it("knows the four budget-reset kinds and no other", () => {
    for (const kind of [
      "budget-reset.requested",
      "budget-reset.approved",
      "budget-reset.denied",
      "budget-reset.expired",
    ]) {
      expect(NotificationKindSchema.safeParse(kind).success).toBe(true);
    }
    expect(NotificationKindSchema.safeParse("key.requested").success).toBe(
      false,
    );
  });
});

describe("BudgetResetSchema (the ledger item; MG-D8)", () => {
  const item = {
    resetId: UUID,
    oid: "oid-ada",
    teamId: "team-a",
    departmentId: "dept-eng",
    litellmTeamId: "lt-1",
    litellmUserId: "lu-1",
    operation: "spend",
    amount: 12.5,
    budget: null,
    trigger: "request",
    actorOid: "oid-lead",
    requestId: UUID,
    timestamp: "2026-11-14T09:00:00.000Z",
  };

  it("accepts a ledger item, with a null budget when unset", () => {
    expect(BudgetResetSchema.safeParse(item).success).toBe(true);
    expect(BudgetResetSchema.safeParse({ ...item, budget: 50 }).success).toBe(
      true,
    );
  });

  it.each(["direct", "request"])(
    "accepts the %s trigger (MG-D8, amended 2026-11-18)",
    (trigger) => {
      expect(BudgetResetSchema.safeParse({ ...item, trigger }).success).toBe(
        true,
      );
    },
  );

  it("BUDGET_RESET_TRIGGERS lists direct and request only (MG-D8, amended 2026-11-18)", () => {
    expect([...BUDGET_RESET_TRIGGERS]).toEqual(["direct", "request"]);
  });

  it.each([
    ["a negative amount", { amount: -1 }],
    ["an unknown trigger", { trigger: "scheduled" }],
    [
      "the removed bulk trigger (MG-D8, amended 2026-11-18)",
      { trigger: "bulk" },
    ],
    ["an unknown operation", { operation: "key" }],
    ["a non-UTC-ISO timestamp", { timestamp: "14/11/2026" }],
    ["an extra field", { reason: "free text" }],
  ])("rejects %s", (_n, over) => {
    expect(BudgetResetSchema.safeParse({ ...item, ...over }).success).toBe(
      false,
    );
  });
});

describe("BudgetResetCountsQuerySchema (MG-D9, Rule 20.8)", () => {
  it("accepts a 90-day range and an optional teamId", () => {
    expect(
      BudgetResetCountsQuerySchema.safeParse({
        dateFrom: "2026-08-17",
        dateTo: "2026-11-14",
        teamId: "team-a",
      }).success,
    ).toBe(true);
  });

  it.each([
    ["91 days", { dateFrom: "2026-08-15", dateTo: "2026-11-14" }],
    ["an inverted range", { dateFrom: "2026-11-14", dateTo: "2026-11-01" }],
    ["a missing dateTo", { dateFrom: "2026-11-01" }],
    [
      "an empty teamId",
      { dateFrom: "2026-11-01", dateTo: "2026-11-14", teamId: "" },
    ],
  ])("rejects %s", (_n, q) => {
    expect(BudgetResetCountsQuerySchema.safeParse(q).success).toBe(false);
  });
});

describe("BudgetResetCountsSchema", () => {
  it("accepts team tallies with optional members and the caller's own tally", () => {
    expect(
      BudgetResetCountsSchema.safeParse({
        teams: [
          {
            teamId: "team-a",
            count: 2,
            amount: 10,
            members: [{ oid: "oid-ada", count: 2, amount: 10 }],
          },
        ],
        own: { count: 0, amount: 0 },
      }).success,
    ).toBe(true);
  });

  it("rejects a negative or fractional count and a missing own tally", () => {
    expect(
      BudgetResetCountsSchema.safeParse({
        teams: [{ teamId: "t", count: -1, amount: 0 }],
        own: { count: 0, amount: 0 },
      }).success,
    ).toBe(false);
    expect(
      BudgetResetCountsSchema.safeParse({
        teams: [{ teamId: "t", count: 1.5, amount: 0 }],
        own: { count: 0, amount: 0 },
      }).success,
    ).toBe(false);
    expect(BudgetResetCountsSchema.safeParse({ teams: [] }).success).toBe(
      false,
    );
  });
});
