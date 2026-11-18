import {
  NotificationListQuerySchema,
  NotificationListResponseSchema,
} from "@llm-usage-lens/shared";
import type {
  BudgetResetRequest,
  NotificationView,
} from "@llm-usage-lens/shared";

import { accessErrorResponse, cursorSecret } from "@/lib/api/access-route";
import { loadManager } from "@/lib/api/matrix-route";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { scopeFor } from "@/lib/api/scoped-rollups";
import { getAllAccounts } from "@/lib/data/account-meta";
import {
  getBudgetResetRequest,
  mayDecide,
  mayReadRequest,
  toRequestViews,
} from "@/lib/data/budget-reset-requests";
import { countUnread, listNotifications } from "@/lib/data/notifications";
import { notifSk } from "@/lib/data/notifications-keys";

// Source: docs/specs/2026-05-15-data-model.md — API Routes
// (`/api/notifications`); LiteLLM spec MG-D13; Access Control BR4/BR8 (a
// notification is a pointer: the request is re-read per call and shown only
// while the caller may still read it; `canDecide` is re-checked each time).
// Never cached (Rule 60.10); Cache-Control is set by withRoute.
export const dynamic = "force-dynamic";

export const GET = withRoute(async (request, _ctx, session) => {
  const query = parseSearchParams(request, NotificationListQuerySchema);
  const oid = session.user.oid;
  const page = await listNotifications(oid, {
    cursorSecret: cursorSecret(),
    ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
  });
  if (!page.ok) return accessErrorResponse(page.code);

  const unreadCount = await countUnread(oid);
  const notifications = page.value.items;

  const requests = new Map<string, BudgetResetRequest | null>();
  for (const id of new Set(notifications.map((n) => n.requestId))) {
    requests.set(id, await getBudgetResetRequest(id));
  }
  const found = [...requests.values()].filter(
    (r): r is BudgetResetRequest => r !== null,
  );

  const accounts = found.length > 0 ? await getAllAccounts() : [];
  const teamOf = (teamId: string) => {
    const meta = accounts.find((a) => a.teamId === teamId);
    return meta
      ? { teamId: meta.teamId, departmentId: meta.departmentId }
      : null;
  };
  const scope = await scopeFor(session, [], {
    teamIds: [...new Set(found.map((r) => r.teamId))],
    departmentIds: [...new Set(found.map((r) => r.departmentId))],
  });
  const actor = await loadManager(session);

  const readable = found.filter((r) => mayReadRequest(scope, r, oid));
  const views = new Map(
    (await toRequestViews(readable)).map((v) => [v.id, v] as const),
  );

  const items: NotificationView[] = notifications.map((n) => {
    const req = requests.get(n.requestId) ?? null;
    const visible = req !== null && mayReadRequest(scope, req, oid);
    const canDecide =
      visible &&
      actor !== null &&
      n.kind === "budget-reset.requested" &&
      req.status === "open" &&
      mayDecide(actor, req, teamOf(req.teamId));
    return {
      id: notifSk(n.createdAt, n.notificationId),
      kind: n.kind,
      createdAt: n.createdAt,
      read: n.readAt !== null,
      teamId: n.teamId,
      requestId: n.requestId,
      request: visible ? (views.get(req.requestId) ?? null) : null,
      canDecide,
    };
  });

  return jsonData(
    NotificationListResponseSchema.parse({
      items,
      unreadCount,
      ...(page.value.cursor ? { cursor: page.value.cursor } : {}),
    }),
  );
});
