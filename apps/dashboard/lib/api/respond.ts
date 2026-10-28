import "server-only";

import { trace } from "@opentelemetry/api";
import type { ApiErrorCode } from "@bedrock-usage/shared";
import { ZodError } from "zod";
import type { ZodType, z } from "zod";

import { auth } from "@/auth";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes"; Rule 10.3,
// Rule 50.4 (401 before any data access), Rule 50.6, Rule 60.18.

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// Thrown only for failures parsing request input; maps to 400. Any other
// ZodError is a server-side contract failure and maps to 500 (no schema text).
// Zod v4 classes use trait-based `instanceof`, so a plain ZodError would also
// match a subclass check; a brand field distinguishes them.
const BAD_REQUEST_BRAND = Symbol("bad-request");

export function isBadRequestError(error: unknown): error is BadRequestError {
  return (
    error instanceof ZodError &&
    (error as { [BAD_REQUEST_BRAND]?: true })[BAD_REQUEST_BRAND] === true
  );
}

export class BadRequestError extends ZodError {
  readonly [BAD_REQUEST_BRAND] = true;

  constructor(issues: ZodError["issues"]) {
    super(issues);
    this.name = "BadRequestError";
  }

  get firstMessage(): string {
    return this.issues[0]?.message ?? "Invalid request";
  }
}

export type RouteContext = { params: Promise<Record<string, string>> };

export function jsonData<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, init);
}

export function jsonError(
  status: 400 | 401 | 404 | 500,
  code: ApiErrorCode,
  message: string,
): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function parseInput<S extends ZodType>(
  input: unknown,
  schema: S,
): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestError(result.error.issues);
  }
  return result.data as z.output<S>;
}

export function parseSearchParams<S extends ZodType>(
  request: Request,
  schema: S,
): z.output<S> {
  return parseInput(
    Object.fromEntries(new URL(request.url).searchParams),
    schema,
  );
}

export async function parseJsonBody<S extends ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new BadRequestError([
      {
        code: "custom",
        message: "Request body must be valid JSON",
        path: [],
        input: undefined,
      },
    ]);
  }
  return parseInput(payload, schema);
}

export function withRoute(
  handler: (request: Request, ctx: RouteContext) => Promise<Response>,
) {
  return async (request: Request, ctx: RouteContext): Promise<Response> => {
    try {
      const session = await auth();
      if (!session) return jsonError(401, "UNAUTHORIZED", "Not authenticated");
      return await handler(request, ctx);
    } catch (error) {
      if (isBadRequestError(error)) {
        return jsonError(400, "BAD_REQUEST", error.firstMessage);
      }
      if (error instanceof NotFoundError) {
        return jsonError(404, "NOT_FOUND", error.message);
      }
      trace
        .getActiveSpan()
        ?.recordException(error instanceof Error ? error : String(error));
      return jsonError(500, "INTERNAL", "Internal server error");
    }
  };
}
