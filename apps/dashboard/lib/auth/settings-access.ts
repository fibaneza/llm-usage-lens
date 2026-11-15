import type { Session } from "next-auth";

import type { AccessViewer } from "@/components/settings/access/types";

// Source: docs/specs/2026-11-10-access-control.md - "Enforcement" / "Evaluation
// order" (the session carries the global roles; admin scopes are read per
// request and a suspended SSO scope grants nothing), "Recent authentication"
// (`authTime` is copied read-only to the session), Rule 10.3 / 50.3 (roles
// resolved on the server and passed to the Settings UI as plain data).
type ViewerSession =
  | {
      user?: {
        oid?: unknown;
        roles?: unknown;
        authMethod?: unknown;
        authTime?: unknown;
      } | null;
    }
  | null
  | undefined;

const AUTH_METHODS: readonly AccessViewer["authMethod"][] = [
  "entra",
  "master",
  "local",
  "password",
];

function authMethodOf(value: unknown): AccessViewer["authMethod"] | null {
  return AUTH_METHODS.find((method) => method === value) ?? null;
}

// Pure: null (fail closed) when the session names no oid or sign-in method.
export function buildAccessViewer(
  session: ViewerSession,
  adminScopes: AccessViewer["adminScopes"],
): AccessViewer | null {
  const user = session?.user;
  if (typeof user?.oid !== "string" || user.oid === "") return null;
  const authMethod = authMethodOf(user.authMethod);
  if (authMethod === null) return null;
  const roles = Array.isArray(user.roles)
    ? (user.roles as unknown[]).filter(
        (role): role is string => typeof role === "string",
      )
    : [];
  const authTime =
    typeof user.authTime === "number" && Number.isFinite(user.authTime)
      ? user.authTime
      : undefined;
  return {
    roles,
    authMethod,
    ...(authTime === undefined ? {} : { authTime }),
    adminScopes: [...adminScopes],
  };
}

// Never cached: the scopes are read per request (Access Control spec -
// Enforcement item 4). A session that builds no viewer reaches no data.
export async function loadSettingsAccessViewer(
  session: Session | null | undefined,
): Promise<AccessViewer | undefined> {
  if (buildAccessViewer(session, []) === null) return undefined;
  const [{ loadWriteActor }, { env }] = await Promise.all([
    import("@/lib/data/access/authorization"),
    import("@/env"),
  ]);
  const actor = await loadWriteActor({ appEnv: env.APP_ENV, session });
  const scopes: AccessViewer["adminScopes"] = actor
    ? [
        ...[...actor.teamScopes].map((scopeId) => ({
          scopeType: "team" as const,
          scopeId,
        })),
        ...[...actor.departmentScopes].map((scopeId) => ({
          scopeType: "department" as const,
          scopeId,
        })),
      ]
    : [];
  const viewer = buildAccessViewer(session, scopes);
  if (viewer === null) return undefined;
  // Effective roles: the claim plus in-app grants, read per request (B1; Rule
  // 60.10). The write actor already merged them.
  const roles = [...new Set([...viewer.roles, ...(actor?.roles ?? [])])];
  return { ...viewer, roles };
}
