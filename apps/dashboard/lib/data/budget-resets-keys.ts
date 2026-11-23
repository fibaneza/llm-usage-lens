// Source: docs/specs/2026-05-15-data-model.md — "Budget reset entities (unit
// M4)". Pure key builders (no server-only, no I/O); they sit outside
// lib/data/access/keys.ts because the access structure test allows imports of
// those keys only from lib/data/access/** and scripts/**.

export const BRREQ_META_SK = "META";
export const BRREQ_CLAIM_SK = "OWNER";

export const brReqPk = (requestId: string) => `BRREQ#${requestId}`;
export const brReqsGsi1pk = (teamId: string) => `BRREQS#TEAM#${teamId}`;
export const brReqGsi1sk = (
  status: string,
  createdAt: string,
  requestId: string,
) => `${status}#${createdAt}#${requestId}`;
export const brReqOpenPk = (teamId: string, oid: string) =>
  `BRREQOPEN#${teamId}#${oid}`;

export const bResetPk = (teamId: string) => `BRESET#TEAM#${teamId}`;
export const bResetSk = (timestamp: string, resetId: string) =>
  `${timestamp}#${resetId}`;
export const bResetLTeamPk = (litellmTeamId: string) =>
  `BRESET#LTEAM#${litellmTeamId}`;
export const bResetLUserPk = (litellmUserId: string) =>
  `BRESET#LUSER#${litellmUserId}`;
export const bResetsGsi1pk = (oid: string) => `BRESETS#IDENT#${oid}`;

// Mirrors lib/data/access/keys.ts (META_SK, identPk) for the recipient lookup.
export const IDENT_META_SK = "META";
export const identItemPk = (oid: string) => `IDENT#${oid}`;
