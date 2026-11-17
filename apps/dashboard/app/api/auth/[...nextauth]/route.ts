import { NextRequest } from "next/server";

import { handlers } from "@/auth";
import { BASE_PATH } from "@/lib/base-path";

// Platform spec - Base path, BP-D9: Route Handlers see req.url without the
// prefix, while Auth.js matches its basePath (<prefix>/api/auth) against it.
function withPrefix(req: NextRequest): NextRequest {
  if (BASE_PATH === "") return req;
  const url = new URL(req.url);
  url.pathname = `${BASE_PATH}${url.pathname}`;
  return new NextRequest(url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1]);
}

export function GET(req: NextRequest): Promise<Response> {
  return handlers.GET(withPrefix(req));
}

export function POST(req: NextRequest): Promise<Response> {
  return handlers.POST(withPrefix(req));
}
