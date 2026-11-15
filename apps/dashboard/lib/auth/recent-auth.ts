// Source: docs/specs/2026-11-10-access-control.md - "Recent authentication"
// (D28). Pure so the window is tested without a clock; the 60 s of future
// allowance matches the session clock-skew allowance.
export const REAUTH_MAX_AGE_SECONDS = 900;
const CLOCK_SKEW_SECONDS = 60;

export function hasRecentAuth(authTime: unknown, nowSeconds: number): boolean {
  return (
    typeof authTime === "number" &&
    Number.isFinite(authTime) &&
    authTime >= nowSeconds - REAUTH_MAX_AGE_SECONDS &&
    authTime <= nowSeconds + CLOCK_SKEW_SECONDS
  );
}
