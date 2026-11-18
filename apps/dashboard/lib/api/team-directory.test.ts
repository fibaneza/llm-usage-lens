import { describe, expect, it, vi } from "vitest";

import type { AccountMeta, AppTeam } from "@llm-usage-lens/shared";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
}));
vi.mock("@/lib/data/access/app-teams", () => ({ listAppTeams: vi.fn() }));
vi.mock("./cached-reads", () => ({ getAllAccountsCached: vi.fn() }));

import { buildTeamDirectory } from "./team-directory";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AppTeam" (the team
// list is the registry teams, deduplicated by teamId, plus the created
// teams, with hasAwsAccount); Access Control — "Created app teams".
const account = (over: Partial<AccountMeta>): AccountMeta => ({
  accountId: "000000000000",
  accountName: "acct",
  departmentId: "dept-eng",
  departmentName: "Engineering",
  teamId: "team-payments",
  teamName: "Payments",
  region: "ap-southeast-2",
  active: true,
  createdAt: "2026-05-15T08:00:00.000Z",
  updatedAt: "2026-05-15T08:00:00.000Z",
  ...over,
});
const appTeam = (over: Partial<AppTeam> = {}): AppTeam => ({
  teamId: "appteam-3f0c1a52-8b7e-4c1d-9a2f-0123456789ab",
  name: "Platform Guild",
  departmentId: "dept-ops",
  departmentName: "Operations",
  createdBy: "oid-1",
  createdAt: "2026-11-18T10:00:00.000Z",
  version: 1,
  ...over,
});

describe("buildTeamDirectory", () => {
  it("maps registry rows with hasAwsAccount true and the AccountMeta field names", () => {
    expect(buildTeamDirectory([account({})], [])).toEqual([
      {
        teamId: "team-payments",
        teamName: "Payments",
        departmentId: "dept-eng",
        departmentName: "Engineering",
        hasAwsAccount: true,
      },
    ]);
  });

  it("deduplicates registry rows by teamId, the first wins", () => {
    const dir = buildTeamDirectory(
      [
        account({ accountId: "000000000000", teamName: "First" }),
        account({ accountId: "123456789012", teamName: "Second" }),
        account({ accountId: "111122223333", teamId: "team-b", teamName: "B" }),
      ],
      [],
    );
    expect(dir.map((e) => [e.teamId, e.teamName])).toEqual([
      ["team-payments", "First"],
      ["team-b", "B"],
    ]);
  });

  it("appends created teams with hasAwsAccount false, mapping name to teamName", () => {
    const dir = buildTeamDirectory([account({})], [appTeam()]);
    expect(dir).toHaveLength(2);
    expect(dir[0]).toMatchObject({
      teamId: "team-payments",
      hasAwsAccount: true,
    });
    expect(dir[1]).toEqual({
      teamId: "appteam-3f0c1a52-8b7e-4c1d-9a2f-0123456789ab",
      teamName: "Platform Guild",
      departmentId: "dept-ops",
      departmentName: "Operations",
      hasAwsAccount: false,
    });
  });

  it("returns only created teams when the registry is empty, and [] when both are", () => {
    expect(buildTeamDirectory([], [appTeam()])).toHaveLength(1);
    expect(buildTeamDirectory([], [])).toEqual([]);
  });
});
