import { randomUUID } from "node:crypto";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import { env } from "@/env";
import { unauthenticatedResponse } from "@/lib/api/unauthenticated";
import {
  DEV_LOGIN_PROVIDER_ID,
  resolveSignInProviders,
} from "@/lib/auth/auth-config";
import { parseEntraProfile } from "@/lib/auth/entra-profile";
import {
  MASTER_USER_PROVIDER_ID,
  authorizeMasterUser,
  type SignedInIdentity,
} from "@/lib/auth/master-user";
import {
  PASSWORD_PROVIDER_ID,
  PASSWORD_SETUP_PROVIDER_ID,
  createPasswordProvider,
  createPasswordSetupProvider,
} from "@/lib/auth/password-providers";
import { parseSessionToken } from "@/lib/auth/session-token";
import { recordSecurityEvent } from "@/lib/auth/security-events";
import {
  INTERNAL_ADMIN_ROLE,
  isGlobalRole,
  parseRoles,
  resolveGlobalRoles,
} from "@/lib/auth/roles";
import {
  SESSION_MAX_AGE_SECONDS,
  isWithinSessionLifetime,
  sessionCapSeconds,
} from "@/lib/auth/session-lifetime";

// `next build` runs with NODE_ENV=production and may lack runtime secrets, so
// the runtime guard must not fire then; it still fires when
// SKIP_ENV_VALIDATION is set at runtime, repeating the production rules (auth
// guide).
const isBuildPhase = env.NEXT_PHASE === "phase-production-build";

export const enabledSignInProviders = isBuildPhase
  ? {
      entra: !!env.AUTH_MICROSOFT_ENTRA_ID_ID,
      devLogin:
        env.NODE_ENV !== "production" &&
        env.AUTH_DEV_LOGIN === "true" &&
        !env.AUTH_MICROSOFT_ENTRA_ID_ID,
      master: !!env.AUTH_MASTER_USERNAME,
    }
  : resolveSignInProviders({
      nodeEnv: env.NODE_ENV,
      appEnv: env.APP_ENV,
      entraId: env.AUTH_MICROSOFT_ENTRA_ID_ID,
      entraSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      entraIssuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      devLogin: env.AUTH_DEV_LOGIN,
      masterUsername: env.AUTH_MASTER_USERNAME,
      masterPasswordHash: env.AUTH_MASTER_PASSWORD_HASH,
      masterTotpSecret: env.AUTH_MASTER_TOTP_SECRET,
    });

// Fail closed: anything but an explicit dev keeps the legacy Admin alias off.
const appEnv = env.APP_ENV === "dev" ? "dev" : "prod";
const tenantId =
  /\/([0-9a-f-]{36})\/v2\.0$/.exec(
    env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ?? "",
  )?.[1] ?? "";

const LOCAL_DEFAULT_EMAIL = "dev@localhost";

function isApiPath(pathname: string | undefined): boolean {
  return pathname === "/api" || pathname?.startsWith("/api/") === true;
}

function isAuthMethod(value: unknown): value is SignedInIdentity["authMethod"] {
  return (
    value === "entra" ||
    value === "master" ||
    value === "local" ||
    value === "password"
  );
}

function entraIdentity(profile: unknown): SignedInIdentity | null {
  const parsed = parseEntraProfile(profile, tenantId);
  if (!parsed) return null;
  const roles = resolveGlobalRoles(parsed.roles, appEnv);
  if (!roles) return null;
  return {
    oid: parsed.oid,
    tid: parsed.tid,
    ...(parsed.email ? { email: parsed.email } : {}),
    ...(parsed.upn ? { upn: parsed.upn } : {}),
    ...(parsed.displayName ? { displayName: parsed.displayName } : {}),
    roles,
    authMethod: "entra",
  };
}

// Credentials providers carry their identity on the `authorize()` user.
function credentialsIdentity(user: unknown): SignedInIdentity | null {
  if (typeof user !== "object" || user === null) return null;
  const u = user as Record<string, unknown>;
  if (typeof u.oid !== "string" || typeof u.tid !== "string") return null;
  if (!isAuthMethod(u.authMethod)) return null;
  const roles = parseRoles(u.roles).filter(isGlobalRole);
  return {
    oid: u.oid,
    tid: u.tid,
    ...(typeof u.email === "string" ? { email: u.email } : {}),
    ...(typeof u.name === "string" ? { displayName: u.name } : {}),
    roles,
    authMethod: u.authMethod,
  };
}

function identityFor(
  provider: string,
  profile: unknown,
  user: unknown,
): SignedInIdentity | null {
  return provider === DEV_LOGIN_PROVIDER_ID ||
    provider === MASTER_USER_PROVIDER_ID ||
    provider === PASSWORD_PROVIDER_ID ||
    provider === PASSWORD_SETUP_PROVIDER_ID
    ? credentialsIdentity(user)
    : entraIdentity(profile);
}

const providers: Provider[] = [
  createPasswordProvider(),
  createPasswordSetupProvider(),
];
if (enabledSignInProviders.entra) {
  providers.push(MicrosoftEntraID);
}
if (enabledSignInProviders.devLogin) {
  // Local development only: fixed identity, role chosen on the sign-in page.
  providers.push(
    Credentials({
      id: DEV_LOGIN_PROVIDER_ID,
      name: "Local developer",
      credentials: { role: {} },
      authorize: async (credentials) => {
        const role = credentials?.role ?? INTERNAL_ADMIN_ROLE;
        if (!isGlobalRole(role)) return null;
        return {
          id: `local:${LOCAL_DEFAULT_EMAIL}`,
          name: "Local Developer",
          email: LOCAL_DEFAULT_EMAIL,
          oid: `local:${LOCAL_DEFAULT_EMAIL}`,
          tid: "local",
          roles: [role],
          authMethod: "local",
        };
      },
    }),
  );
}
if (
  enabledSignInProviders.master &&
  env.AUTH_MASTER_USERNAME &&
  env.AUTH_MASTER_PASSWORD_HASH
) {
  const config = {
    username: env.AUTH_MASTER_USERNAME,
    passwordHash: env.AUTH_MASTER_PASSWORD_HASH,
    ...(env.AUTH_MASTER_TOTP_SECRET
      ? { totpSecret: env.AUTH_MASTER_TOTP_SECRET }
      : {}),
  };
  providers.push(
    Credentials({
      id: MASTER_USER_PROVIDER_ID,
      name: "Master user",
      credentials: { username: {}, password: {}, totp: {} },
      authorize: async (credentials) => {
        const identity = await authorizeMasterUser(credentials, config);
        return identity ? { id: identity.oid, ...identity } : null;
      },
    }),
  );
}

// Auth.js is the identity-provider abstraction (Rule 50.3). Switching providers
// is a change to this file only — pages, proxy, and route guards use the
// Auth.js session APIs and never change. See docs/guides/auth-setup.md.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  // Roles are read at sign-in, so a revoked Admin keeps access until the
  // session ends. `maxAge` is only the idle timeout (Auth.js re-issues the JWT
  // on every request); the jwt callback enforces the absolute 8-hour lifetime
  // (System Architecture — "Account-mutation role").
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: {
    signIn: "/sign-in",
    error: "/no-access",
  },
  callbacks: {
    // Gates the routes matched by proxy.ts.
    // A logged-out /api/* call gets the JSON 401 that withRoute returns, not a
    // redirect to /sign-in (Data Model — "API Routes"; Rule 10.3, Rule 50.4).
    // Pages keep the redirect. The proxy matcher already skips /api/auth/* and
    // /api/health, and the route handlers keep their own checks.
    authorized: ({ auth, request }) => {
      if (auth?.user?.oid) return true;
      return isApiPath(request?.nextUrl?.pathname)
        ? unauthenticatedResponse()
        : false;
    },
    // Fail closed (Access Control spec — Threat model T1): a malformed token
    // or a failed identity upsert yields no session.
    signIn: async ({ user, account, profile }) => {
      const provider = account?.provider ?? "";
      const identity = identityFor(provider, profile, user);
      if (!identity) return false;
      const requestId = randomUUID();
      const sequence = { next: 0 };
      const now = new Date();
      try {
        // Loaded on demand: the data layer is server-only and pulls the AWS SDK.
        const { upsertIdentity } = await import("@/lib/data/identity");
        await upsertIdentity(identity, now);
        if (identity.authMethod === "entra") {
          // The sync writes auth.signin.success in its own transaction (D18).
          const claims = parseEntraProfile(profile, tenantId);
          if (!claims) return false;
          const { applySignInResolution } =
            await import("@/lib/data/access/sign-in-sync");
          await applySignInResolution({
            identity,
            groups: claims.groups,
            groupsOverage: claims.groupsOverage,
            expectedTid: tenantId,
            requestId,
            now,
            sequence,
          });
        } else {
          const { recordSignIn } =
            await import("@/lib/data/access/session-audit");
          await recordSignIn({
            oid: identity.oid,
            method: identity.authMethod,
            requestId,
            now,
          });
        }
      } catch (error) {
        const span = trace.getActiveSpan();
        span?.recordException(error instanceof Error ? error : String(error));
        span?.setStatus({ code: SpanStatusCode.ERROR });
        try {
          await recordSecurityEvent({
            action: "auth.signin.error",
            result: "failed",
            oid: identity.oid,
            at: new Date().toISOString(),
            requestId,
            sequence,
          });
        } catch (eventError) {
          span?.recordException(
            eventError instanceof Error ? eventError : String(eventError),
          );
        }
        return false;
      }
      return true;
    },
    // `account` is set only on the sign-in call, which starts a new session
    // (even over an expired token). Later calls keep the token while it is
    // within its role-dependent cap; a token with no valid sign-in time, or
    // one dated more than the clock-skew allowance ahead, is rejected, and
    // returning null makes Auth.js clear the session. The `session` payload of
    // an `update` is never merged, so identity and roles change only at
    // sign-in. iat/exp/jti are re-issued per request, so they are never used
    // as the sign-in time.
    jwt: ({ token, account, profile, user }) => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (account) {
        const identity = identityFor(account.provider, profile, user);
        if (!identity) return null;
        token.oid = identity.oid;
        token.tid = identity.tid;
        token.roles = identity.roles;
        token.authMethod = identity.authMethod;
        token.signedInAt = nowSeconds;
        return parseSessionToken(token) ? token : null;
      }
      if (!parseSessionToken(token)) return null;
      const cap = sessionCapSeconds({
        roles: parseRoles(token.roles),
        authMethod:
          typeof token.authMethod === "string" ? token.authMethod : "",
      });
      return isWithinSessionLifetime(token.signedInAt, nowSeconds, cap)
        ? token
        : null;
    },
    session: ({ session, token }) => {
      const claims = parseSessionToken(token);
      if (!claims) return { expires: session.expires } as typeof session;
      return {
        ...session,
        user: {
          ...session.user,
          oid: claims.oid,
          tid: claims.tid,
          roles: parseRoles(claims.roles),
          authMethod: claims.authMethod,
        },
      };
    },
  },
  events: {
    // Best-effort: a sign-out never fails because its record could not be
    // stored (Access Control spec - Audit log D18).
    signOut: async (message) => {
      try {
        const token = "token" in message ? message.token : null;
        if (typeof token?.oid !== "string" || token.oid === "") return;
        const method = token.authMethod;
        if (!isAuthMethod(method)) return;
        const { recordSignOut } =
          await import("@/lib/data/access/session-audit");
        await recordSignOut({
          oid: token.oid,
          method,
          requestId: randomUUID(),
          now: new Date(),
        });
      } catch (error) {
        trace
          .getActiveSpan()
          ?.recordException(error instanceof Error ? error : String(error));
      }
    },
  },
});

export async function signInWithEntra() {
  "use server";
  await signIn("microsoft-entra-id", { redirectTo: "/dashboard" });
}

export async function signInWithDevLogin(formData: FormData) {
  "use server";
  const role = formData.get("role");
  await signIn(DEV_LOGIN_PROVIDER_ID, {
    ...(typeof role === "string" ? { role } : {}),
    redirectTo: "/dashboard",
  });
}

export async function signInWithMasterUser(formData: FormData) {
  "use server";
  await signIn(MASTER_USER_PROVIDER_ID, {
    username: formData.get("username"),
    password: formData.get("password"),
    totp: formData.get("totp"),
    redirectTo: "/dashboard",
  });
}
