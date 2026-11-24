import { describe, expect, it } from "vitest";

import {
  AFFILIATION_SK,
  GROUPMAPS_GSI1PK,
  IDENTS_GSI1PK,
  LINK_SK,
  LOCALUSERS_GSI1PK,
  OWNER_SK,
  PENDINGLITELLMLINKS_GSI1PK,
  PENDING_LITELLMLINK_SK,
  ROLEGRANTS_GSI1PK,
  adminScopeSk,
  APPTEAMS_GSI1PK,
  adminsGsi1pk,
  appTeamGsi1sk,
  appTeamNamePk,
  appTeamPk,
  auditPk,
  auditSk,
  groupMapPk,
  identPk,
  localUserPk,
  membersGsi1pk,
  pendingPk,
  roleGrantGsi1sk,
  roleGrantSk,
  usageKeyPk,
  visibilityPk,
} from "./keys";

// Source: docs/specs/2026-11-10-access-control.md — "Data model additions" and
// "Storage boundary (D26.3, amended R2a)"; contract R2 §2 (key design) and the
// 2026-11-13 addendum (keys.ts is pure, no `server-only`).
describe("access-control key builders", () => {
  it("exposes the fixed sort keys and GSI1 partitions", () => {
    expect(IDENTS_GSI1PK).toBe("IDENTS");
    expect(AFFILIATION_SK).toBe("AFFILIATION");
    expect(LINK_SK).toBe("LINK");
    expect(OWNER_SK).toBe("OWNER");
    expect(ROLEGRANTS_GSI1PK).toBe("ROLEGRANTS");
    expect(GROUPMAPS_GSI1PK).toBe("GROUPMAPS");
    expect(LOCALUSERS_GSI1PK).toBe("LOCALUSERS");
  });

  it("builds identity and scope keys", () => {
    expect(identPk("abc")).toBe("IDENT#abc");
    expect(adminScopeSk("team", "t1")).toBe("ADMINSCOPE#TEAM#t1");
    expect(adminScopeSk("department", "d1")).toBe("ADMINSCOPE#DEPT#d1");
    expect(membersGsi1pk("t1")).toBe("MEMBERS#TEAM#t1");
    expect(adminsGsi1pk("team", "t1")).toBe("ADMINS#TEAM#t1");
    expect(adminsGsi1pk("department", "d1")).toBe("ADMINS#DEPT#d1");
  });

  it("builds role-grant keys", () => {
    expect(roleGrantSk("internal-admin")).toBe("ROLEGRANT#internal-admin");
    expect(roleGrantGsi1sk("abc", "internal-admin")).toBe(
      "IDENT#abc#internal-admin",
    );
  });

  it("lower-cases emails in pending and local-user keys", () => {
    expect(pendingPk("Ada@Example.COM")).toBe("PENDING#ada@example.com");
    expect(localUserPk("Ada@Example.COM")).toBe("LOCALUSER#ada@example.com");
  });

  it("builds mapping, visibility and usage-key keys", () => {
    expect(groupMapPk("g-1")).toBe("GROUPMAP#g-1");
    expect(visibilityPk("team", "t1")).toBe("VIS#TEAM#t1");
    expect(visibilityPk("department", "d1")).toBe("VIS#DEPT#d1");
    expect(usageKeyPk("jane@example.com")).toBe("USAGEKEY#jane@example.com");
  });

  it("builds audit keys with a two-digit transaction index", () => {
    expect(auditPk("2026-11-14")).toBe("AUDIT#2026-11-14");
    expect(auditSk("2026-11-14T10:00:00.000Z", "req-1", 0)).toBe(
      "2026-11-14T10:00:00.000Z#req-1#00",
    );
    expect(auditSk("2026-11-14T10:00:00.000Z", "req-1", 12)).toBe(
      "2026-11-14T10:00:00.000Z#req-1#12",
    );
  });

  // Source: Data Model — "Entity: AppTeam"; Access Control — "Data model additions".
  it("builds app-team keys", () => {
    expect(APPTEAMS_GSI1PK).toBe("APPTEAMS");
    expect(appTeamPk("appteam-x")).toBe("APPTEAM#appteam-x");
    expect(appTeamGsi1sk("appteam-x")).toBe("APPTEAM#appteam-x");
    expect(appTeamNamePk("  Platform GUILD ")).toBe(
      "APPTEAMNAME#platform guild",
    );
  });

  // Source: Access Control - "Data model additions" (PendingLiteLLMLink:
  // PENDING#{email} or PENDING#{oid} / LITELLMLINK, GSI1 PENDINGLITELLMLINKS /
  // PENDING#{emailOrOid}); "LiteLLM user sync" - Pending LiteLLM links
  // (lower-cased key, shared partition with the pending items).
  it("builds the pending LiteLLM link keys on the shared pending partition", () => {
    expect(PENDING_LITELLMLINK_SK).toBe("LITELLMLINK");
    expect(PENDINGLITELLMLINKS_GSI1PK).toBe("PENDINGLITELLMLINKS");
    expect(pendingPk("Ada@Example.COM")).toBe("PENDING#ada@example.com");
    expect(pendingPk("00000000-0000-4000-8000-00000000AAAA")).toBe(
      "PENDING#00000000-0000-4000-8000-00000000aaaa",
    );
    expect(PENDING_LITELLMLINK_SK).not.toBe(AFFILIATION_SK);
  });
});
