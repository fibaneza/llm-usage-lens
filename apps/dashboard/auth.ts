import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import { env } from "@/env";
import {
  DEV_LOGIN_PROVIDER_ID,
  resolveSignInProviders,
} from "@/lib/auth/auth-config";
import { ADMIN_ROLE, parseRoles, rolesFromProfile } from "@/lib/auth/roles";
import {
  SESSION_MAX_AGE_SECONDS,
  isWithinSessionLifetime,
} from "@/lib/auth/session-lifetime";

// `next build` runs with NODE_ENV=production and may lack runtime secrets, so
// the runtime guard must not fire then; it still fires when
// SKIP_ENV_VALIDATION is set at runtime, repeating the production rules (auth
// guide).
const isBuildPhase = env.NEXT_PHASE === "phase-production-build";

export const enabledSignInProviders = isBuildPhase
  ? {
      entra: !!env.AUTH_MICROSOFT_ENTRA_ID_ID,
      devLogin: env.NODE_ENV !== "production" && env.AUTH_DEV_LOGIN === "true",
    }
  : resolveSignInProviders({
      nodeEnv: env.NODE_ENV,
      entraId: env.AUTH_MICROSOFT_ENTRA_ID_ID,
      entraSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      entraIssuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      devLogin: env.AUTH_DEV_LOGIN,
    });

const providers: Provider[] = [];
if (enabledSignInProviders.entra) {
  providers.push(MicrosoftEntraID);
}
if (enabledSignInProviders.devLogin) {
  // Local development only: no credentials, fixed identity.
  providers.push(
    Credentials({
      id: DEV_LOGIN_PROVIDER_ID,
      name: "Local developer",
      credentials: {},
      authorize: async () => ({
        id: "local-developer",
        name: "Local Developer",
        email: "dev@localhost",
      }),
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
  },
  callbacks: {
    // Gates the routes matched by proxy.ts.
    authorized: ({ auth }) => !!auth,
    // `account` is set only on the sign-in call, which starts a new session
    // (even over an expired token). Later calls keep the token while it is
    // within the lifetime; a token with no valid sign-in time is rejected, and
    // returning null makes Auth.js clear the session. iat/exp/jti are re-issued
    // per request, so they are never used as the sign-in time.
    jwt: ({ token, account, profile }) => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (account) {
        token.roles =
          account.provider === DEV_LOGIN_PROVIDER_ID
            ? [ADMIN_ROLE]
            : rolesFromProfile(profile);
        token.signedInAt = nowSeconds;
        return token;
      }
      return isWithinSessionLifetime(token.signedInAt, nowSeconds)
        ? token
        : null;
    },
    session: ({ session, token }) => ({
      ...session,
      user: { ...session.user, roles: parseRoles(token.roles) },
    }),
  },
});

export async function signInWithEntra() {
  "use server";
  await signIn("microsoft-entra-id", { redirectTo: "/dashboard" });
}

export async function signInWithDevLogin() {
  "use server";
  await signIn(DEV_LOGIN_PROVIDER_ID, { redirectTo: "/dashboard" });
}
