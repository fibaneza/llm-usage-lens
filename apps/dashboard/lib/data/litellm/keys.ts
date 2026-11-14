// Source: docs/specs/2026-11-10-litellm.md — "Data model additions".
export const LITELLM_CONFIG_PK = "LITELLM#CONFIG";
export const LITELLM_CONNECTION_SK = "CONNECTION";
export const LITELLM_TOGGLES_SK = "TOGGLES";
export const LITELLM_TEAMLINK_META_SK = "META";
export const LITELLM_CLAIM_OWNER_SK = "OWNER";
export const LITELLM_TEAMLINKS_GSI1PK = "LITELLM#TEAMLINKS";
export const teamLinkPk = (teamId: string): string =>
  `LITELLM#TEAMLINK#${teamId}`;
export const teamLinkGsi1sk = (teamId: string): string => `TEAM#${teamId}`;
export const teamLinkClaimPk = (litellmTeamId: string): string =>
  `LITELLM#LTEAM#${litellmTeamId}`;
