// Single-table key builders — the one place key formats are defined, shared by
// the dashboard data layer, seed scripts and the Phase 6 collector.
// Source: docs/specs/2026-05-15-data-model.md — "Table Definition" + "Entity Map".

export const TABLE_NAME_DEFAULT = "bedrock-usage";
export const GSI1_NAME = "GSI1";

export const META_SK = "META";
export const SYSTEM_PK = "SYSTEM";
export const SYNC_SK = "SYNC#LATEST";

export const accountPk = (accountId: string): string => `ACCT#${accountId}`;
export const dailySk = (utcDay: string): string => `DAILY#${utcDay}`;
export const datePk = (utcDay: string): string => `DATE#${utcDay}`;
export const deptPk = (departmentId: string): string => `DEPT#${departmentId}`;

// Access Control spec — "Data model additions"; contract R2 §2.
export type ScopeType = "team" | "department";

export const IDENTS_GSI1PK = "IDENTS";
export const AFFILIATION_SK = "AFFILIATION";
export const LINK_SK = "LINK";
export const OWNER_SK = "OWNER";
export const ROLEGRANTS_GSI1PK = "ROLEGRANTS";
export const GROUPMAPS_GSI1PK = "GROUPMAPS";
export const LOCALUSERS_GSI1PK = "LOCALUSERS";

const scopeTag = (t: ScopeType): string => (t === "team" ? "TEAM" : "DEPT");

export const identPk = (oid: string): string => `IDENT#${oid}`;
export const adminScopeSk = (t: ScopeType, id: string): string =>
  `ADMINSCOPE#${scopeTag(t)}#${id}`;
export const membersGsi1pk = (teamId: string): string =>
  `MEMBERS#TEAM#${teamId}`;
export const adminsGsi1pk = (t: ScopeType, id: string): string =>
  `ADMINS#${scopeTag(t)}#${id}`;
export const roleGrantSk = (role: string): string => `ROLEGRANT#${role}`;
export const roleGrantGsi1sk = (oid: string, role: string): string =>
  `IDENT#${oid}#${role}`;
export const pendingPk = (emailOrUpn: string): string =>
  `PENDING#${emailOrUpn.toLowerCase()}`;
export const groupMapPk = (groupId: string): string => `GROUPMAP#${groupId}`;
export const visibilityPk = (t: ScopeType, id: string): string =>
  `VIS#${scopeTag(t)}#${id}`;
export const localUserPk = (email: string): string =>
  `LOCALUSER#${email.toLowerCase()}`;
export const usageKeyPk = (key: string): string => `USAGEKEY#${key}`;
export const auditPk = (utcDay: string): string => `AUDIT#${utcDay}`;
export const auditSk = (
  timestamp: string,
  requestId: string,
  index: number,
): string => `${timestamp}#${requestId}#${String(index).padStart(2, "0")}`;
