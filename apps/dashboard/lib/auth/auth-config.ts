export const DEV_LOGIN_PROVIDER_ID = "dev-login";

// An app role grants writes, so the issuer must name one tenant: the
// multi-tenant `common`/`organizations`/`consumers` issuers are not GUIDs and
// fail. Anchored on both ends; lowercase hex and no trailing slash match the
// issuer Entra publishes, which Auth.js compares exactly (System Architecture —
// "Authentication & Access" → "Sign-in providers"). `env.ts` applies it per
// field; `resolveSignInProviders` repeats it so a skipped validation cannot
// enable Entra with a multi-tenant issuer.
export const ENTRA_TENANT_ISSUER_PATTERN =
  /^https:\/\/login\.microsoftonline\.com\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/v2\.0$/;

export const ENTRA_TENANT_ISSUER_MESSAGE =
  "AUTH_MICROSOFT_ENTRA_ID_ISSUER must be https://login.microsoftonline.com/<tenant GUID, lowercase>/v2.0; common, organizations and consumers are not allowed.";

export const MASTER_HASH_PREFIX = "$argon2id$";

// The committed `.env.example` value: public, so sessions signed with it are
// forgeable. Allowed only for local development (auth guide — Dev-only local
// login).
export const LOCAL_AUTH_SECRET_PLACEHOLDER = "local-dev-placeholder";

export type AppEnv = "dev" | "prod";
export type AccessMode = "open" | "enforce";

export type AuthEnvInput = {
  nodeEnv: string | undefined;
  appEnv?: string | undefined;
  entraId?: string;
  entraSecret?: string;
  entraIssuer?: string;
  devLogin?: string;
  masterUsername?: string;
  masterPasswordHash?: string;
  masterTotpSecret?: string;
};

export type SignInProviders = {
  entra: boolean;
  devLogin: boolean;
  master: boolean;
};

// Messages name variables only, never their values (Rule 50.6).
export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

const isSet = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

// Access Control spec — Environment: unset or invalid falls back to enforce;
// open is never allowed in prod.
export function resolveAccessMode(
  raw: string | undefined,
  appEnv: AppEnv,
): AccessMode {
  if (raw === "open") {
    if (appEnv === "prod") {
      throw new AuthConfigError(
        "AUTH_ACCESS_MODE=open is not allowed when APP_ENV=prod.",
      );
    }
    return "open";
  }
  return "enforce";
}

// The build phase runs with placeholder env, so it never throws; at runtime an
// invalid combination (open in prod) fails fast.
export function resolveRuntimeAccessMode(input: {
  isBuildPhase: boolean;
  raw: string | undefined;
  appEnv: string | undefined;
}): AccessMode {
  if (input.isBuildPhase) return input.raw === "open" ? "open" : "enforce";
  return resolveAccessMode(input.raw, input.appEnv === "prod" ? "prod" : "dev");
}

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
  if (entra && !ENTRA_TENANT_ISSUER_PATTERN.test(input.entraIssuer ?? "")) {
    throw new AuthConfigError(ENTRA_TENANT_ISSUER_MESSAGE);
  }

  if (input.appEnv !== "dev" && input.appEnv !== "prod") {
    throw new AuthConfigError("APP_ENV must be set to dev or prod.");
  }
  const prod = input.appEnv === "prod";

  const masterSet = [input.masterUsername, input.masterPasswordHash].filter(
    isSet,
  ).length;
  if (masterSet === 1) {
    throw new AuthConfigError(
      "The master user is partially configured: set both AUTH_MASTER_USERNAME and AUTH_MASTER_PASSWORD_HASH, or neither.",
    );
  }
  const master = masterSet === 2;
  if (master && !input.masterPasswordHash?.startsWith(MASTER_HASH_PREFIX)) {
    throw new AuthConfigError(
      "AUTH_MASTER_PASSWORD_HASH must be an Argon2id hash.",
    );
  }

  if (isSet(input.devLogin) && (production || entra)) {
    throw new AuthConfigError(
      production
        ? "AUTH_DEV_LOGIN must not be set in production."
        : "AUTH_DEV_LOGIN must not be set when Microsoft Entra ID is configured.",
    );
  }
  // Pre-SSO mode (Access Control spec — "Pre-SSO mode"): prod may run without
  // Entra only through the master user, whose TOTP is checked below.
  if (prod && !entra && !master) {
    throw new AuthConfigError(
      "Microsoft Entra ID or the master user must be configured when APP_ENV=prod.",
    );
  }
  if (prod && master && !isSet(input.masterTotpSecret)) {
    throw new AuthConfigError(
      "AUTH_MASTER_TOTP_SECRET is required when APP_ENV=prod and the master user is configured.",
    );
  }
  if (production && !entra && !master) {
    throw new AuthConfigError(
      "A production sign-in provider must be configured: Microsoft Entra ID or the master user.",
    );
  }

  const devLogin = !production && input.devLogin === "true";
  if (!entra && !devLogin && !master) {
    throw new AuthConfigError(
      "No sign-in provider is enabled: configure Microsoft Entra ID or set AUTH_DEV_LOGIN=true (non-production only).",
    );
  }

  return { entra, devLogin, master };
}
