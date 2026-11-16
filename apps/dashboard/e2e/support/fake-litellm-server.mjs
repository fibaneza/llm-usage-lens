import { createServer } from "node:http";

// Test-only fake LiteLLM proxy (docs/litellm/openapi.json shapes for the few
// reads the "My usage" view makes). Listens on 127.0.0.1 only, no outbound
// network (Rule 60.24). Values mirror E2E_LITELLM_USER in constants.ts.
const PORT = Number(process.env.E2E_LITELLM_PORT ?? 3212);
const KEY = process.env.E2E_LITELLM_SERVICE_KEY ?? "";
const USER = {
  userId: "litellm-u-ada",
  email: "ada.lovelace@example.test",
  spend: 42.5,
};

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (KEY && req.headers.authorization !== `Bearer ${KEY}`) {
    return reply(res, 401, { error: "unauthorised" });
  }
  if (req.method !== "GET") {
    // Connection-test write probes target non-existent ids: a 4xx means the
    // route is allowed.
    return reply(res, 404, { detail: "not found" });
  }
  switch (url.pathname) {
    case "/team/list":
      return reply(res, 200, []);
    case "/user/list": {
      const email = (url.searchParams.get("user_email") ?? "").toLowerCase();
      const found = email === USER.email;
      return reply(res, 200, {
        users: found
          ? [
              {
                user_id: USER.userId,
                user_email: USER.email,
                user_role: "internal_user",
              },
            ]
          : [],
        total: found ? 1 : 0,
        page: 1,
        page_size: 25,
        total_pages: found ? 1 : 0,
      });
    }
    case "/user/info":
      return reply(res, 200, {
        user_id: url.searchParams.get("user_id"),
        user_info: {
          user_id: url.searchParams.get("user_id"),
          user_email: USER.email,
          user_role: "internal_user",
          spend: USER.spend,
          max_budget: null,
        },
        keys: [],
        teams: [],
      });
    case "/user/daily/activity":
      return reply(res, 200, { results: [], metadata: {} });
    default:
      return reply(res, 404, { detail: "not found" });
  }
}).listen(PORT, "127.0.0.1");
