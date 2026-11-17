import "server-only";

import {
  PasswordUserListItemSchema,
  type PasswordUserListItem,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import { accessErrorResponse } from "@/lib/api/access-route";
import { BadRequestError, jsonData, parseInput } from "@/lib/api/respond";
import { getPasswordUserListItem } from "@/lib/data/access/password-users";
import { withBasePath } from "@/lib/base-path";

// Source: docs/specs/2026-11-10-access-control.md - "Password users" (Setup
// D22: the link is shown once, never stored or logged) and "API routes
// (additions)". Shared plumbing for the /api/password-users Route Handlers.

const PathEmailSchema = z.email().max(254);

// The path segment is percent-decoded here (Next may or may not have done it),
// lower-cased and validated; a malformed value is a 400, never a lookup.
export function parsePathEmail(raw: string | undefined): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw ?? "");
  } catch {
    throw new BadRequestError([
      {
        code: "custom",
        message: "Invalid email",
        path: ["email"],
        input: undefined,
      },
    ]);
  }
  return parseInput(decoded.toLowerCase(), PathEmailSchema);
}

// The link host is the request Host, never x-forwarded-host (Enforcement).
export function setupLink(request: Request, token: string): string {
  const host = request.headers.get("host") || new URL(request.url).host;
  return `https://${host}${withBasePath("/account/setup")}#${token}`;
}

export type PasswordUserRouteContext = {
  params: Promise<{ email: string }>;
};

export async function userResponse(
  email: string,
  extra: { setupLink?: string } = {},
  init?: ResponseInit,
): Promise<Response> {
  const user = await getPasswordUserListItem(email);
  if (!user) return accessErrorResponse("NOT_FOUND");
  const row: PasswordUserListItem = PasswordUserListItemSchema.parse(user);
  return jsonData(
    extra.setupLink ? { user: row, setupLink: extra.setupLink } : row,
    init,
  );
}
