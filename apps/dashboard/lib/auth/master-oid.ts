// Dependency-free so callers (auth.ts, dev-identity) need not load the master
// user's Argon2/TOTP modules. Access Control spec - "Dev login" (L3c).
export const MASTER_OID_PREFIX = "master:";
