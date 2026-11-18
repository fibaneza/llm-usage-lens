// Source: docs/specs/2026-05-15-data-model.md — "Budget reset entities (unit
// M4)": Notification keys. Pure: no I/O, so it may sit outside lib/data/access.
export const notifPk = (oid: string): string => `NOTIF#${oid}`;
export const notifSk = (createdAt: string, notificationId: string): string =>
  `${createdAt}#${notificationId}`;
