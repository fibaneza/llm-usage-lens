import "server-only";

// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" item 7
// (host or host:port allowlist, https when APP_ENV=prod, no userinfo, query or
// fragment) and threat LT6 (SSRF through the stored base URL).

export type BaseUrlCheck =
  | { ok: true; baseUrl: string }
  | { ok: false; reason: string };

export function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== "");
}

// Rejection reasons never echo the input, so credentials in a rejected URL
// cannot reach a response or a log.
export function validateLiteLLMBaseUrl(
  raw: string,
  options: { allowedHosts: readonly string[]; appEnv: "dev" | "prod" },
): BaseUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Base URL is not a valid URL" };
  }
  const schemes = options.appEnv === "prod" ? ["https:"] : ["https:", "http:"];
  if (!schemes.includes(url.protocol)) {
    return {
      ok: false,
      reason:
        options.appEnv === "prod"
          ? "Base URL must use https"
          : "Base URL must use http or https",
    };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "Base URL must not contain credentials" };
  }
  if (raw.includes("?") || raw.includes("#")) {
    return {
      ok: false,
      reason: "Base URL must not contain a query or fragment",
    };
  }
  if (!options.allowedHosts.includes(url.host.toLowerCase())) {
    return { ok: false, reason: "Base URL host is not allowed" };
  }
  return {
    ok: true,
    baseUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, ""),
  };
}
