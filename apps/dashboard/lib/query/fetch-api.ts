import { ApiErrorBodySchema } from "@llm-usage-lens/shared";
import { z } from "zod";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes"; Rule 20.11
// (response shape validated on both ends).

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function parseApiResponse<S extends z.ZodType>(
  res: Response,
  dataSchema: S,
): Promise<z.output<S>> {
  const body: unknown = await res.json();
  const errorBody = ApiErrorBodySchema.safeParse(body);
  if (errorBody.success) {
    throw new ApiRequestError(
      res.status,
      errorBody.data.error.code,
      errorBody.data.error.message,
    );
  }
  const success = z.object({ data: dataSchema }).parse(body) as {
    data: z.output<S>;
  };
  return success.data;
}

export async function fetchApi<S extends z.ZodType>(
  path: string,
  dataSchema: S,
): Promise<z.output<S>> {
  return parseApiResponse(await fetch(path), dataSchema);
}

export async function mutateApi<S extends z.ZodType>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
  dataSchema: S,
): Promise<z.output<S>> {
  const res = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  return parseApiResponse(res, dataSchema);
}
