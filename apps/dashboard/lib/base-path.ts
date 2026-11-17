// Platform spec - Base path (unit BP): BP-D2 (format), BP-D3 (one helper),
// BP-D13 (no imports; reads NEXT_PUBLIC_BASE_PATH directly because env.ts pulls
// server configuration into the client bundle - the documented Rule 50.2
// exception). Client-safe: next.config.ts, auth.ts and Client Components use it.
const BASE_PATH_PATTERN = /^(\/[a-z0-9-]+)+$/;
const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

export function parseBasePath(value: string | undefined): string {
  if (value === undefined || value === "") return "";
  if (!BASE_PATH_PATTERN.test(value)) {
    throw new Error(
      "NEXT_PUBLIC_BASE_PATH must be empty or lower-case /segments (letters, digits, hyphens) with no trailing slash.",
    );
  }
  return value;
}

export const BASE_PATH = parseBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

export function withBasePath(path: string, prefix: string = BASE_PATH): string {
  if (prefix === "" || !path.startsWith("/") || ABSOLUTE_URL.test(path)) {
    return path;
  }
  const boundary = path.slice(prefix.length, prefix.length + 1);
  const inside =
    path.startsWith(prefix) && (boundary === "" || /[/?#]/.test(boundary));
  return inside ? path : `${prefix}${path}`;
}

export function stripBasePath(
  pathname: string,
  prefix: string = BASE_PATH,
): string {
  if (prefix === "") return pathname;
  if (pathname === prefix) return "/";
  return pathname.startsWith(`${prefix}/`)
    ? pathname.slice(prefix.length)
    : pathname;
}
