// Pure access-control key builders (no `server-only`, no AWS SDK) so seed
// scripts can share them with the storage modules.
// Source: docs/specs/2026-11-10-access-control.md — "Data model additions" and
// "Storage boundary (D26.3, amended R2a)".

export type ScopeType = "team" | "department";

export const IDENTS_GSI1PK = "IDENTS";
export const AFFILIATION_SK = "AFFILIATION";
export const LINK_SK = "LINK";
export const OWNER_SK = "OWNER";
export const META_SK = "META";
export const GOVERNANCE_PK = "GOVERNANCE";
export const PASSWORD_SIGNIN_SK = "PASSWORD_SIGNIN";
export const ROLEGRANTS_GSI1PK = "ROLEGRANTS";
export const GROUPMAPS_GSI1PK = "GROUPMAPS";
export const LOCALUSERS_GSI1PK = "LOCALUSERS";
// PendingLiteLLMLink shares the PENDING#{key} partition (Access Control - Data
// model additions); readers of that partition skip this sort key.
export const PENDING_LITELLMLINK_SK = "LITELLMLINK";
export const PENDINGLITELLMLINKS_GSI1PK = "PENDINGLITELLMLINKS";

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
export const ssoExpectPk = (kind: "OID" | "UPN", value: string): string =>
  `SSOEXPECT#${kind}#${kind === "UPN" ? value.toLowerCase() : value}`;
export const ssoRefPk = (tid: string, oid: string): string =>
  `SSOREF#${tid}#${oid}`;
// Setup-link lookup by token hash (the token is the only input at setup).
export const setupLinkPk = (tokenHash: string): string =>
  `SETUPLINK#${tokenHash}`;

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AppTeam".
export const APPTEAMS_GSI1PK = "APPTEAMS";
export const appTeamPk = (teamId: string): string => `APPTEAM#${teamId}`;
export const appTeamGsi1sk = (teamId: string): string => `APPTEAM#${teamId}`;
export const appTeamNamePk = (name: string): string =>
  `APPTEAMNAME#${name.trim().toLowerCase()}`;
// One-to-one claim of a LiteLLM user by an identity (management improvements
// D16; Access Control - Data model additions, LiteLLMUserClaim).
export const litellmUserPk = (litellmUserId: string): string =>
  `LITELLMUSER#${litellmUserId}`;
