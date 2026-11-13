import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { authorizePasswordUser } from "./password-credentials";
import { completePasswordSetup } from "./password-setup";

// Source: docs/specs/2026-11-10-access-control.md — "Password users" (Setup:
// the Auth.js `password-setup` provider; Sign-in: the `password` provider).
// Factories only; auth.ts registers them (R2b integration).
export const PASSWORD_PROVIDER_ID = "password";
export const PASSWORD_SETUP_PROVIDER_ID = "password-setup";

type Identity = {
  oid: string;
  tid: string;
  email: string;
  displayName?: string;
  authMethod: "password";
};

const toUser = (identity: Identity) => ({
  id: identity.oid,
  ...identity,
  ...(identity.displayName ? { name: identity.displayName } : {}),
});

const SetupCredentialsSchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(1).max(256),
  totpSecret: z.string().max(64).optional(),
  totpCode: z.string().max(16).optional(),
});

// Auth.js reports `credentials` as the top-level id; the configured id is only
// in `options`, so set it on the provider itself.
function withId(
  id: string,
  options: Parameters<typeof Credentials>[0],
): Provider {
  return { ...Credentials(options), id };
}

export function createPasswordProvider(): Provider {
  return withId(PASSWORD_PROVIDER_ID, {
    id: PASSWORD_PROVIDER_ID,
    name: "Password",
    credentials: { email: {}, password: {}, totp: {} },
    authorize: async (credentials) => {
      const identity = await authorizePasswordUser(credentials);
      return identity ? toUser(identity) : null;
    },
  });
}

export function createPasswordSetupProvider(): Provider {
  return withId(PASSWORD_SETUP_PROVIDER_ID, {
    id: PASSWORD_SETUP_PROVIDER_ID,
    name: "Password setup",
    credentials: { token: {}, password: {}, totpSecret: {}, totpCode: {} },
    authorize: async (credentials) => {
      const parsed = SetupCredentialsSchema.safeParse(credentials);
      if (!parsed.success) return null;
      const { token, password, totpSecret, totpCode } = parsed.data;
      const result = await completePasswordSetup(
        {
          token,
          password,
          ...(totpSecret && totpCode
            ? { totp: { secret: totpSecret, code: totpCode } }
            : {}),
        },
        {},
      );
      return result.ok ? toUser(result.identity) : null;
    },
  });
}
