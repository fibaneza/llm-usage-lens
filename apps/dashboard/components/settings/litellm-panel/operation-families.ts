// Source: docs/specs/2026-11-10-litellm.md -- Allowlist "Reads" and "Writes"
// tables (G6): Guardrails groups operations by family; each row describes the
// LiteLLM call it gates. Dashboard-only L7 operations have no LiteLLM call.
export const OPERATION_FAMILIES = [
  {
    id: "team-writes",
    label: "Team writes",
    description: "Create a team and change its budget, limits and models.",
  },
  {
    id: "member-writes",
    label: "Member writes",
    description: "Add, remove, limit, reset and disable team members.",
  },
  {
    id: "key-writes",
    label: "Key writes",
    description:
      "Generate, change, block, delete and rotate keys, and the key request flow.",
  },
  {
    id: "team-reads",
    label: "Team reads",
    description: "Read team details, the proxy team list and team spend.",
  },
  {
    id: "user-reads",
    label: "User reads",
    description: "Look up users and read their spend.",
  },
  {
    id: "key-spend-reads",
    label: "Key and spend reads",
    description: "List and inspect keys and read spend logs.",
  },
  {
    id: "proxy-reads",
    label: "Proxy reads",
    description: "Read proxy-wide models, the audit log and spend reports.",
  },
] as const;

export const OTHER_FAMILY = {
  id: "other",
  label: "Other operations",
  description: "Operations this dashboard version does not recognise.",
} as const;

type FamilyId = (typeof OPERATION_FAMILIES)[number]["id"];

export const OPERATION_INFO: Record<
  string,
  { family: FamilyId; description: string }
> = {
  createTeam: { family: "team-writes", description: "POST /team/new" },
  setTeamBudget: {
    family: "team-writes",
    description: "POST /team/update (budget)",
  },
  setTeamLimits: {
    family: "team-writes",
    description: "POST /team/update (rate limits)",
  },
  setTeamModels: {
    family: "team-writes",
    description: "POST /team/update (models)",
  },
  createUser: {
    family: "member-writes",
    description: "POST /user/new",
  },
  addTeamMember: {
    family: "member-writes",
    description: "POST /team/member_add",
  },
  removeTeamMember: {
    family: "member-writes",
    description: "POST /team/member_delete",
  },
  setMemberBudget: {
    family: "member-writes",
    description: "POST /team/member_update (budget)",
  },
  setMemberLimits: {
    family: "member-writes",
    description: "POST /team/member_update (rate limits)",
  },
  resetMemberSpend: {
    family: "member-writes",
    description: "POST /team/{team_id}/member/{user_id}/reset_spend",
  },
  resetUserSpend: {
    family: "member-writes",
    description: "POST /user/update (spend 0)",
  },
  resetMemberBudget: {
    family: "member-writes",
    description: "POST /team/{team_id}/member/{user_id}/reset_budget",
  },
  disableMember: {
    family: "member-writes",
    description: "POST /key/block for each of the member's keys in the team",
  },
  enableMember: {
    family: "member-writes",
    description: "POST /key/unblock for each of the member's keys in the team",
  },
  requestBudgetReset: {
    family: "member-writes",
    description: "Dashboard only: records a budget reset request",
  },
  generateMemberKey: {
    family: "key-writes",
    description: "POST /key/generate",
  },
  updateMemberKey: { family: "key-writes", description: "POST /key/update" },
  blockKey: { family: "key-writes", description: "POST /key/block" },
  unblockKey: { family: "key-writes", description: "POST /key/unblock" },
  deleteKey: { family: "key-writes", description: "POST /key/delete" },
  rotateKey: {
    family: "key-writes",
    description: "POST /key/{key}/regenerate, or generate then block on OSS",
  },
  requestKey: {
    family: "key-writes",
    description: "Dashboard only: records a key request",
  },
  approveKeyRequest: {
    family: "key-writes",
    description: "Dashboard only: approves a key request",
  },
  rejectKeyRequest: {
    family: "key-writes",
    description: "Dashboard only: rejects a key request",
  },
  revealKeyRequest: {
    family: "key-writes",
    description: "Calls generateMemberKey to issue the approved key",
  },
  getTeam: { family: "team-reads", description: "GET /team/info" },
  listProxyTeams: { family: "team-reads", description: "GET /team/list" },
  getTeamDailySpend: {
    family: "team-reads",
    description: "GET /team/daily/activity/aggregated",
  },
  getUser: { family: "user-reads", description: "GET /user/info" },
  findUserByEmail: {
    family: "user-reads",
    description: "GET /user/list (by email)",
  },
  searchUsers: { family: "user-reads", description: "GET /user/list (search)" },
  getUserDailySpend: {
    family: "user-reads",
    description: "GET /user/daily/activity",
  },
  listKeys: { family: "key-spend-reads", description: "GET /key/list" },
  getKey: { family: "key-spend-reads", description: "GET /key/info" },
  listSpendLogs: {
    family: "key-spend-reads",
    description: "GET /spend/logs/v2",
  },
  listProxyModels: { family: "proxy-reads", description: "GET /models" },
  listProxyAuditLog: { family: "proxy-reads", description: "GET /audit" },
  getGlobalSpendReport: {
    family: "proxy-reads",
    description: "GET /global/spend/report",
  },
};
