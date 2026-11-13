// Source: docs/specs/2026-11-10-access-control.md — "Storage boundary (D26)";
// contract R2 §4 (error model). Expected outcomes are returned, unexpected
// errors are thrown.
export type AccessErrorCode =
  | "CONFLICT"
  | "MANAGED_BY_SSO"
  | "ALREADY_AFFILIATED"
  | "NOT_FOUND"
  | "BAD_CURSOR";

export type AccessResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: AccessErrorCode };

// `sequence.next` is the request's audit index ({nn}); records take it and
// advance it only when a record is written.
export type AuditContext = {
  actor: string;
  requestId: string;
  now: Date;
  sequence: { next: number };
};

export type Page<T> = { items: T[]; cursor?: string };

export type ListOptions = {
  cursorSecret: string;
  cursor?: string;
  limit?: number;
};
