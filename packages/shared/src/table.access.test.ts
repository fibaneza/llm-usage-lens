import { describe, expect, it } from "vitest";

import {
  AFFILIATION_SK,
  GROUPMAPS_GSI1PK,
  IDENTS_GSI1PK,
  LINK_SK,
  LOCALUSERS_GSI1PK,
  OWNER_SK,
  ROLEGRANTS_GSI1PK,
  adminScopeSk,
  adminsGsi1pk,
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
} from "./table";

// Source: docs/specs/2026-11-10-access-control.md — "Data model additions";
// contract R2 §2-§3 (key design) and decision 4 (audit SK index suffix).
describe("access-control key builders", () => {
  it("exposes the fixed partition and sort keys", () => {
    expect(IDENTS_GSI1PK).toBe("IDENTS");
    expect(AFFILIATION_SK).toBe("AFFILIATION");
    expect(LINK_SK).toBe("LINK");
    expect(OWNER_SK).toBe("OWNER");
    expect(ROLEGRANTS_GSI1PK).toBe("ROLEGRANTS");
    expect(GROUPMAPS_GSI1PK).toBe("GROUPMAPS");
    expect(LOCALUSERS_GSI1PK).toBe("LOCALUSERS");
  });

  it("builds identity, group mapping and usage key partition keys", () => {
    expect(identPk("00000000-0000-4000-8000-000000000001")).toBe(
      "IDENT#00000000-0000-4000-8000-000000000001",
    );
    expect(groupMapPk("g-1")).toBe("GROUPMAP#g-1");
    expect(usageKeyPk("jane@example.com")).toBe("USAGEKEY#jane@example.com");
  });

  it("builds admin scope keys per scope type", () => {
    expect(adminScopeSk("team", "t1")).toBe("ADMINSCOPE#TEAM#t1");
    expect(adminScopeSk("department", "d1")).toBe("ADMINSCOPE#DEPT#d1");
    expect(adminsGsi1pk("team", "t1")).toBe("ADMINS#TEAM#t1");
    expect(adminsGsi1pk("department", "d1")).toBe("ADMINS#DEPT#d1");
  });

  it("builds the team members GSI1 partition", () => {
    expect(membersGsi1pk("t1")).toBe("MEMBERS#TEAM#t1");
  });

  it("builds role grant keys", () => {
    expect(roleGrantSk("internal-admin")).toBe("ROLEGRANT#internal-admin");
    expect(roleGrantGsi1sk("o1", "internal-admin")).toBe(
      "IDENT#o1#internal-admin",
    );
  });

  it("builds visibility partition keys per scope type", () => {
    expect(visibilityPk("team", "t1")).toBe("VIS#TEAM#t1");
    expect(visibilityPk("department", "d1")).toBe("VIS#DEPT#d1");
  });

  it("lower-cases pending and local user keys", () => {
    expect(pendingPk("Jane.Doe@Example.COM")).toBe(
      "PENDING#jane.doe@example.com",
    );
    expect(localUserPk("Dev@Example.com")).toBe("LOCALUSER#dev@example.com");
  });

  it("builds audit keys with a two-digit record index", () => {
    expect(auditPk("2026-11-12")).toBe("AUDIT#2026-11-12");
    expect(auditSk("2026-11-12T01:02:03.000Z", "req-1", 0)).toBe(
      "2026-11-12T01:02:03.000Z#req-1#00",
    );
    expect(auditSk("2026-11-12T01:02:03.000Z", "req-1", 3)).toBe(
      "2026-11-12T01:02:03.000Z#req-1#03",
    );
    expect(auditSk("2026-11-12T01:02:03.000Z", "req-1", 12)).toBe(
      "2026-11-12T01:02:03.000Z#req-1#12",
    );
  });

  it("gives records of one request distinct sort keys", () => {
    const ts = "2026-11-12T01:02:03.000Z";
    expect(auditSk(ts, "r", 0)).not.toBe(auditSk(ts, "r", 1));
  });
});
