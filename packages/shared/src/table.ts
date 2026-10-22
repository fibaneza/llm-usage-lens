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
