export const DEV_LOGIN_PROVIDER_ID = "dev-login";

export type AuthEnvInput = {
  nodeEnv: string | undefined;
  entraId?: string;
  entraSecret?: string;
  entraIssuer?: string;
  devLogin?: string;
};

export type SignInProviders = { entra: boolean; devLogin: boolean };

// Messages name variables only, never their values (Rule 50.6).
export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

const isSet = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

// Sign-in providers rule set: system-architecture spec — Authentication &
// Access; auth guide — Dev-only local login.
export function resolveSignInProviders(input: AuthEnvInput): SignInProviders {
  const production = input.nodeEnv === "production";
  const entraSet = [input.entraId, input.entraSecret, input.entraIssuer].filter(
    isSet,
  ).length;

  if (entraSet > 0 && entraSet < 3) {
    throw new AuthConfigError(
      "Microsoft Entra ID is partially configured: set all of AUTH_MICROSOFT_ENTRA_ID_ID, AUTH_MICROSOFT_ENTRA_ID_SECRET and AUTH_MICROSOFT_ENTRA_ID_ISSUER, or none.",
    );
  }
  const entra = entraSet === 3;

  if (production && isSet(input.devLogin)) {
    throw new AuthConfigError("AUTH_DEV_LOGIN must not be set in production.");
  }
  if (production && !entra) {
    throw new AuthConfigError(
      "Microsoft Entra ID must be configured in production.",
    );
  }

  const devLogin = !production && input.devLogin === "true";
  if (!entra && !devLogin) {
    throw new AuthConfigError(
      "No sign-in provider is enabled: configure Microsoft Entra ID or set AUTH_DEV_LOGIN=true (non-production only).",
    );
  }

  return { entra, devLogin };
}
