import { randomUUID } from "node:crypto";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import NextAuth, { AuthError } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import { env } from "@/env";
import { unauthenticatedResponse } from "@/lib/api/unauthenticated";
import {
  DEV_LOGIN_PROVIDER_ID,
  resolveSignInProviders,
} from "@/lib/auth/auth-config";
import { MASTER_OID_PREFIX } from "@/lib/auth/master-oid";
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
import { authCookies, resolveRedirect } from "@/lib/auth/base-path-auth";
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
import { BASE_PATH, stripBasePath, withBasePath } from "@/lib/base-path";

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

// Password users also carry their credential version (D29).
type CredentialsIdentity = SignedInIdentity & { credentialVersion?: number };

// Credentials providers carry their identity on the `authorize()` user.
function credentialsIdentity(user: unknown): CredentialsIdentity | null {
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
    ...(typeof u.credentialVersion === "number"
      ? { credentialVersion: u.credentialVersion }
      : {}),
  };
}

function authTimeFor(
  provider: string,
  profile: unknown,
  nowSeconds: number,
): number | undefined {
  if (provider !== "microsoft-entra-id") return nowSeconds;
  const claim =
    typeof profile === "object" && profile !== null
      ? (profile as Record<string, unknown>).auth_time
      : undefined;
  return typeof claim === "number" && Number.isInteger(claim)
    ? claim
    : undefined;
}

function identityFor(
  provider: string,
  profile: unknown,
  user: unknown,
): CredentialsIdentity | null {
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
  // Local development only: a stored identity signs in with its stored roles;
  // the posted role applies only to the Local Developer.
  providers.push(
    Credentials({
      id: DEV_LOGIN_PROVIDER_ID,
      name: "Local developer",
      credentials: { role: {}, identity: {} },
      authorize: async (credentials) => {
        // Loaded on demand: the resolver reads DynamoDB (server-only).
        const { resolveDevIdentity } = await import("@/lib/auth/dev-identity");
        const resolved = await resolveDevIdentity(credentials?.identity);
        if (!resolved.ok) return null;
        const { oid, email, name } = resolved.identity;
        if (oid.toLowerCase().startsWith(MASTER_OID_PREFIX)) return null;
        let roles = resolved.identity.roles;
        if (!roles) {
          const role = credentials?.role ?? INTERNAL_ADMIN_ROLE;
          if (!isGlobalRole(role)) return null;
          roles = [role];
        }
        return {
          id: oid,
          name,
          ...(email ? { email } : {}),
          oid,
          tid: "local",
          roles,
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

// Fail closed: a missing or disabled user, another oid, a lower token version
// or a failed read ends the session. The session that changed its own password
// is re-keyed by the server-side marker matching its own signedInAt; nothing
// the client sends is read (T31 pattern, T34).
async function followCredentialVersion(token: JWT): Promise<JWT | null> {
  if (typeof token.email !== "string" || token.email === "") return null;
  try {
    const { getPasswordCredential } =
      await import("@/lib/data/access/password-credentials-store");
    const credential = await getPasswordCredential(token.email);
    if (
      !credential ||
      credential.status !== "enabled" ||
      credential.oid !== token.oid
    ) {
      return null;
    }
    let version =
      typeof token.credentialVersion === "number" ? token.credentialVersion : 0;
    if (
      credential.selfChangeSignedInAt === token.signedInAt &&
      credential.credentialVersion > version
    ) {
      version = credential.credentialVersion;
      token.credentialVersion = version;
    }
    return version < credential.credentialVersion ? null : token;
  } catch (error) {
    trace
      .getActiveSpan()
      ?.recordException(error instanceof Error ? error : String(error));
    return null;
  }
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
  // Unit BP: with a prefix Auth.js needs its own basePath (BP-D9), prefixed
  // pages (BP-D11) and path-scoped, app-named cookies (BP-D8, BP-D12). Without
  // one the Auth.js defaults stay.
  ...(BASE_PATH === ""
    ? {}
    : {
        basePath: withBasePath("/api/auth"),
        cookies: authCookies(
          BASE_PATH,
          env.AUTH_URL?.startsWith("https://") === true,
        ),
      }),
  pages: {
    signIn: withBasePath("/sign-in"),
    error: withBasePath("/no-access"),
  },
  callbacks: {
    // Under a prefix the origin is AUTH_URL's: NextRequest rewrites a loopback
    // IP in the request URL to "localhost", so Auth.js's baseUrl can differ
    // from the origin the browser used. Without a prefix baseUrl is unchanged.
    redirect: ({ url, baseUrl }) =>
      resolveRedirect(
        url,
        BASE_PATH !== "" && env.AUTH_URL
          ? new URL(env.AUTH_URL).origin
          : baseUrl,
        BASE_PATH,
      ),
    // Gates the routes matched by proxy.ts.
    // A logged-out /api/* call gets the JSON 401 that withRoute returns, not a
    // redirect to /sign-in (Data Model — "API Routes"; Rule 10.3, Rule 50.4).
    // Pages keep the redirect. The proxy matcher already skips /api/auth/* and
    // /api/health, and the route handlers keep their own checks.
    // Unit BP (BP-D10): with AUTH_URL set next-auth rebuilds the request
    // without Next's basePath, so strip the prefix here and return an explicit
    // prefixed redirect for pages.
    authorized: ({ auth, request }) => {
      if (auth?.user?.oid) return true;
      const nextUrl = request?.nextUrl;
      const pathname = stripBasePath(nextUrl?.pathname ?? "");
      if (isApiPath(pathname)) return unauthenticatedResponse();
      if (BASE_PATH === "") return false;
      const callbackUrl = withBasePath(`${pathname}${nextUrl?.search ?? ""}`);
      // Absolute: Next's proxy rejects a relative Location.
      const signIn = new URL(withBasePath("/sign-in"), nextUrl?.origin);
      signIn.searchParams.set("callbackUrl", callbackUrl);
      return Response.redirect(signIn, 307);
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
    // A password session is also checked against the stored credential version
    // on every call, uncached (Access Control spec - Password users, D29, T34).
    jwt: async ({ token, account, profile, user }) => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (account) {
        const identity = identityFor(account.provider, profile, user);
        if (!identity) return null;
        token.oid = identity.oid;
        token.tid = identity.tid;
        token.roles = identity.roles;
        token.authMethod = identity.authMethod;
        // Millisecond precision: the same-user session comparison (D29) must
        // tell two sign-ins within one second apart.
        token.signedInAt = Date.now() / 1000;
        if (String(identity.authMethod) === "password") {
          token.credentialVersion = identity.credentialVersion ?? 0;
          if (identity.email) token.email = identity.email;
        } else {
          delete token.credentialVersion;
        }
        // Entra reports when the user last authenticated; an SSO session
        // reused without a prompt keeps its old time. Without a valid integer
        // the claim is left out and a step-up is needed (D28, T31, T32).
        const authTime = authTimeFor(account.provider, profile, nowSeconds);
        if (authTime === undefined) delete token.authTime;
        else token.authTime = authTime;
        return parseSessionToken(token) ? token : null;
      }
      if (!parseSessionToken(token)) return null;
      const cap = sessionCapSeconds({
        roles: parseRoles(token.roles),
        authMethod:
          typeof token.authMethod === "string" ? token.authMethod : "",
      });
      if (!isWithinSessionLifetime(token.signedInAt, nowSeconds, cap)) {
        return null;
      }
      return token.authMethod === "password"
        ? await followCredentialVersion(token)
        : token;
    },
    session: ({ session, token }) => {
      const claims = parseSessionToken(token);
      if (!claims) return { expires: session.expires } as typeof session;
      // authTime comes from the token only; an incoming value is dropped.
      const incoming: Record<string, unknown> = { ...session.user };
      delete incoming.authTime;
      delete incoming.signedInAt;
      return {
        ...session,
        user: {
          ...incoming,
          oid: claims.oid,
          tid: claims.tid,
          roles: parseRoles(claims.roles),
          authMethod: claims.authMethod,
          ...(claims.authTime !== undefined
            ? { authTime: claims.authTime }
            : {}),
          ...(typeof token.signedInAt === "number"
            ? { signedInAt: token.signedInAt }
            : {}),
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

// A refused identity is the one generic `{ ok: false }`; success redirects.
export async function signInWithDevLogin(
  _previous: { ok: false } | null,
  formData: FormData,
): Promise<{ ok: false } | null> {
  "use server";
  const role = formData.get("role");
  const identity = formData.get("identity");
  try {
    await signIn(DEV_LOGIN_PROVIDER_ID, {
      ...(typeof role === "string" ? { role } : {}),
      ...(typeof identity === "string" ? { identity } : {}),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) return { ok: false };
    throw error;
  }
  return null;
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

// Source: docs/specs/2026-11-10-access-control.md - "Password users" (Setup
// D22). The token travels in the URL fragment, so the page reaches the server
// only through these two actions. Read-only: shows whose account the link is
// for and whether TOTP enrolment is mandatory; null is the one generic answer.
export async function previewPasswordSetupLink(token: string) {
  "use server";
  if (typeof token !== "string") return null;
  const { previewPasswordSetup } = await import("@/lib/auth/password-setup");
  return previewPasswordSetup(token);
}

// A refused setup is the one generic `{ ok: false }`; success redirects.
export async function signInWithPasswordSetup(
  formData: FormData,
): Promise<{ ok: false } | void> {
  "use server";
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  try {
    await signIn(PASSWORD_SETUP_PROVIDER_ID, {
      token: text("token"),
      password: text("password"),
      totpSecret: text("totpSecret"),
      totpCode: text("totpCode"),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) return { ok: false };
    throw error;
  }
}
