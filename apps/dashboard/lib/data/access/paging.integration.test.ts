import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  clearTable,
  ensureTestTable,
  putRaw,
} from "@/test/support/test-support";

import { decodeCursor, encodeCursor } from "./cursor";
import { queryPage } from "./paging";

// Source: docs/specs/2026-11-10-access-control.md - `/api/audit` row, "From
// 2026-11-24 (unit SRT1": an optional `direction` on queryPage. The signed
// cursor carries it; a cursor minted without a direction (today's encoding)
// still works for a caller passing none or asc (read as asc); a cursor from the other direction is
// BAD_CURSOR; desc returns newest first; the page-size cap is unchanged.
// app/api/audit/route.ts passes direction asc by default, so the direction-less
// cursor cases below cover /api/audit's cursors minted before the deploy.
const SECRET = "paging-test-secret";
const PK = "PAGING#test";
const Item = z.object({ PK: z.string(), SK: z.string() }).passthrough();
const sks = (items: { SK: string }[]) => items.map((i) => i.SK);
const KEYS = ["A#1", "A#2", "A#3", "A#4", "A#5"];

const run = (
  extra: {
    direction?: "asc" | "desc";
    cursor?: string;
    limit?: number;
    sortPrefix?: string;
  } = {},
) =>
  queryPage({
    schema: Item,
    partition: PK,
    ...(extra.sortPrefix ? { sortPrefix: extra.sortPrefix } : {}),
    ...(extra.direction ? { direction: extra.direction } : {}),
    options: {
      cursorSecret: SECRET,
      ...(extra.cursor ? { cursor: extra.cursor } : {}),
      ...(extra.limit ? { limit: extra.limit } : {}),
    },
  });

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  for (const SK of KEYS) await putRaw({ PK, SK });
  await putRaw({ PK, SK: "B#1" });
  await putRaw({ PK: "PAGING#other", SK: "A#1" });
});

describe("queryPage direction (unit SRT1)", () => {
  it("without a direction pages ascending exactly as before, and the cursor carries no direction", async () => {
    const r = await run({ limit: 2 });
    if (!r.ok) throw new Error("expected ok");
    expect(sks(r.value.items)).toEqual(["A#1", "A#2"]);
    const decoded = decodeCursor(r.value.cursor!, SECRET);
    expect(decoded.ok && Object.keys(decoded.value).sort()).toEqual([
      "PK",
      "SK",
    ]);
  });

  it("a cursor signed without a direction is accepted by a caller passing none and gives the next page as before", async () => {
    const legacy = encodeCursor({ PK, SK: "A#2" }, SECRET);
    const r = await run({ cursor: legacy, limit: 2, sortPrefix: "A#" });
    if (!r.ok) throw new Error("expected ok");
    expect(sks(r.value.items)).toEqual(["A#3", "A#4"]);
  });

  it("desc returns newest first and its cursor continues desc without repeats", async () => {
    const first = await run({ direction: "desc", limit: 2, sortPrefix: "A#" });
    if (!first.ok) throw new Error("expected ok");
    expect(sks(first.value.items)).toEqual(["A#5", "A#4"]);
    const second = await run({
      direction: "desc",
      limit: 2,
      sortPrefix: "A#",
      cursor: first.value.cursor!,
    });
    if (!second.ok) throw new Error("expected ok");
    expect(sks(second.value.items)).toEqual(["A#3", "A#2"]);
  });

  it("asc explicit pages oldest first and round-trips its own cursor", async () => {
    const first = await run({ direction: "asc", limit: 2, sortPrefix: "A#" });
    if (!first.ok) throw new Error("expected ok");
    expect(sks(first.value.items)).toEqual(["A#1", "A#2"]);
    const second = await run({
      direction: "asc",
      limit: 2,
      sortPrefix: "A#",
      cursor: first.value.cursor!,
    });
    if (!second.ok) throw new Error("expected ok");
    expect(sks(second.value.items)).toEqual(["A#3", "A#4"]);
  });

  it.each([
    ["desc", "asc"],
    ["asc", "desc"],
  ] as const)(
    "a %s cursor under %s is BAD_CURSOR",
    async (minted, requested) => {
      const first = await run({ direction: minted, limit: 2 });
      if (!first.ok) throw new Error("expected ok");
      const r = await run({
        direction: requested,
        cursor: first.value.cursor!,
      });
      expect(r).toEqual({ ok: false, code: "BAD_CURSOR" });
    },
  );

  // Coordinator ruling W1 (2026-11-24): a cursor signed before unit SRT1 has
  // no direction field and is read as asc, so it survives /api/audit always
  // passing a direction (Access Control `/api/audit` row, "From 2026-11-24
  // (unit SRT1").
  it("a direction-less cursor is read as asc: accepted by a caller passing direction asc", async () => {
    const legacy = encodeCursor({ PK, SK: "A#2" }, SECRET);
    const r = await run({
      direction: "asc",
      cursor: legacy,
      limit: 2,
      sortPrefix: "A#",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(sks(r.value.items)).toEqual(["A#3", "A#4"]);
  });

  it("a direction-less cursor is read as asc: BAD_CURSOR for a caller passing direction desc", async () => {
    const legacy = encodeCursor({ PK, SK: "A#2" }, SECRET);
    expect(await run({ direction: "desc", cursor: legacy })).toEqual({
      ok: false,
      code: "BAD_CURSOR",
    });
  });

  it("the partition scope filter holds in desc: no row of another partition or prefix", async () => {
    const r = await run({ direction: "desc", sortPrefix: "A#" });
    if (!r.ok) throw new Error("expected ok");
    expect(sks(r.value.items)).toEqual(["A#5", "A#4", "A#3", "A#2", "A#1"]);
  });

  it("the page-size cap is unchanged: an oversize limit is capped at 100 in both directions", async () => {
    for (let i = 0; i < 120; i += 1) {
      await putRaw({ PK: "PAGING#big", SK: `N#${String(i).padStart(3, "0")}` });
    }
    for (const direction of [undefined, "desc"] as const) {
      const r = await queryPage({
        schema: Item,
        partition: "PAGING#big",
        ...(direction ? { direction } : {}),
        options: { cursorSecret: SECRET, limit: 1000 },
      });
      if (!r.ok) throw new Error("expected ok");
      expect(r.value.items).toHaveLength(100);
    }
  });
});
