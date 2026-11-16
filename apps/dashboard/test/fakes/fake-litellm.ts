// Test-only fake LiteLLM (Rule 60.24: no real network). An in-process `fetch`
// stand-in installed with vi.stubGlobal; it records every call and honours the
// request's AbortSignal so timeout tests run under fake timers.
export type FakeCall = {
  url: string;
  host: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  redirect: RequestRedirect | undefined;
};
export type FakeReply =
  | { status: number; body?: unknown }
  | "hang"
  | "network-error";
export type FakeHandler = (call: FakeCall, attempt: number) => FakeReply;

export const TEMPLATED_PROBES = [
  /^\/team\/[^/]+\/member\/[^/]+\/reset_spend$/,
  /^\/team\/[^/]+\/member\/[^/]+\/reset_budget$/,
  /^\/key\/[^/]+\/regenerate$/,
] as const;

// Healthy LiteLLM: reads answer 200; the templated write routes answer 404
// (allowed by allowed_routes, unknown ids) as the LD4 probe expects.
export const healthyHandler: FakeHandler = (call) => {
  if (TEMPLATED_PROBES.some((re) => re.test(call.path))) {
    return { status: 404, body: { detail: "not found" } };
  }
  if (call.path === "/team/list") return { status: 200, body: [] };
  if (call.path === "/models") return { status: 200, body: { data: [] } };
  return { status: 404, body: { detail: "not found" } };
};

export function createFakeLiteLLM(initial: FakeHandler = healthyHandler) {
  let handler = initial;
  const calls: FakeCall[] = [];
  const attempts = new Map<string, number>();

  const fetchFake = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: FakeCall = {
      url: url.href,
      host: url.host,
      method: (init?.method ?? "GET").toUpperCase(),
      path: url.pathname,
      headers,
      body,
      redirect: init?.redirect,
    };
    calls.push(call);
    const key = `${call.method} ${call.path}`;
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    const reply = handler(call, attempt);
    if (reply === "network-error") {
      return Promise.reject(new TypeError("fetch failed"));
    }
    if (reply === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }
    return Promise.resolve(
      new Response(
        reply.body === undefined ? null : JSON.stringify(reply.body),
        {
          status: reply.status,
          headers: { "content-type": "application/json" },
        },
      ),
    );
  };

  return {
    calls,
    fetch: fetchFake as unknown as typeof fetch,
    setHandler(next: FakeHandler) {
      handler = next;
    },
  };
}
