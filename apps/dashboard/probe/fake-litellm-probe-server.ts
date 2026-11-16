import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { FAKE_LITELLM_PORT, FAKE_LITELLM_TEAM_ID } from "./probe-constants";

// Source: docs/specs/2026-11-10-litellm.md - "End-to-end probe" (Results: a
// separate, named fake mode runs the same walk against a fake; it is never a
// fallback, Rule 60.24). A small stateful stand-in for the LiteLLM 1.109.1
// routes the walk reaches (docs/litellm/openapi.json shapes): the team, user,
// member and key writes, chat completions that accrue spend, and reset_spend.
// Listens on 127.0.0.1 only; no outbound network. Started by
// playwright.probe.config.ts in fake mode only; never in real mode.
const TEAM_ALIAS = "llmul-probe";
const MODEL = "claude-haiku";
const COST_PER_CHAT = 0.0004;
const SERVICE_KEY = process.env.PROBE_FAKE_SERVICE_KEY ?? "";

type Json = Record<string, unknown>;
type Member = {
  spend: number;
  maxBudget: number | null;
  rpm: number | null;
  tpm: number | null;
};
type KeyRow = {
  value: string;
  token: string;
  userId: string;
  alias: string | null;
  blocked: boolean;
  spend: number;
};

const users = new Map<string, { email: string; role: string }>();
const members = new Map<string, Member>();
const keys = new Map<string, KeyRow>();

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
const notFound = (res: ServerResponse) =>
  reply(res, 404, { detail: "not found" });

async function readBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? {} : (JSON.parse(text) as Json);
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function keyRow(k: KeyRow) {
  return {
    token: k.token,
    team_id: FAKE_LITELLM_TEAM_ID,
    user_id: k.userId,
    key_alias: k.alias,
    blocked: k.blocked,
    models: [MODEL],
    spend: k.spend,
  };
}

function teamInfo() {
  return {
    team_id: FAKE_LITELLM_TEAM_ID,
    team_info: {
      team_id: FAKE_LITELLM_TEAM_ID,
      team_alias: TEAM_ALIAS,
      max_budget: null,
      spend: [...members.values()].reduce((sum, m) => sum + m.spend, 0),
      models: [MODEL],
      members_with_roles: [...members.keys()].map((id) => ({
        user_id: id,
        user_email: users.get(id)?.email ?? id,
        role: "user",
      })),
    },
    keys: [],
    team_memberships: [...members.entries()].map(([id, m]) => ({
      user_id: id,
      spend: m.spend,
      litellm_budget_table: {
        max_budget: m.maxBudget,
        budget_duration: null,
        rpm_limit: m.rpm,
        tpm_limit: m.tpm,
        max_parallel_requests: null,
      },
    })),
  };
}

function chat(req: IncomingMessage, res: ServerResponse): void {
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const row = [...keys.values()].find((k) => k.value === bearer);
  // Inference with the service key is refused (LD18); so is an unknown or
  // blocked key.
  if (!row || row.blocked) return reply(res, 401, { error: "unauthorised" });
  row.spend += COST_PER_CHAT;
  const member = members.get(row.userId);
  if (member) member.spend += COST_PER_CHAT;
  return reply(res, 200, {
    id: "chatcmpl-probe",
    object: "chat.completion",
    model: MODEL,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: "ok" },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
  });
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const route = `${req.method} ${url.pathname}`;
  const q = url.searchParams;

  if (route === "POST /chat/completions") return chat(req, res);
  if (req.headers.authorization !== `Bearer ${SERVICE_KEY}`) {
    return reply(res, 401, { error: "unauthorised" });
  }

  const body = req.method === "POST" ? await readBody(req) : {};
  const reset = /^POST \/team\/([^/]+)\/member\/([^/]+)\/reset_(spend|budget)$/;
  const resetMatch = reset.exec(route);
  if (resetMatch) {
    const [, teamId, rawUser, what] = resetMatch;
    const member = members.get(decodeURIComponent(rawUser ?? ""));
    if (teamId !== FAKE_LITELLM_TEAM_ID || !member) return notFound(res);
    if (what === "spend") member.spend = 0;
    return reply(
      res,
      200,
      what === "spend" ? {} : { budget_id: "b2", previous_budget_id: "b1" },
    );
  }

  switch (route) {
    case "GET /team/list":
      return reply(res, 200, [
        { team_id: FAKE_LITELLM_TEAM_ID, team_alias: TEAM_ALIAS },
      ]);
    case "GET /team/info":
      return q.get("team_id") === FAKE_LITELLM_TEAM_ID
        ? reply(res, 200, teamInfo())
        : notFound(res);
    case "GET /models":
      return reply(res, 200, { data: [{ id: MODEL, object: "model" }] });
    case "GET /user/list": {
      const email = (q.get("user_email") ?? "").toLowerCase();
      const found = [...users.entries()].filter(([, u]) => u.email === email);
      return reply(res, 200, {
        users: found.map(([id, u]) => ({
          user_id: id,
          user_email: u.email,
          user_role: u.role,
        })),
        total: found.length,
        page: 1,
        page_size: 25,
        total_pages: 1,
      });
    }
    case "GET /user/info": {
      const id = q.get("user_id") ?? "";
      const user = users.get(id);
      if (!user) return notFound(res);
      return reply(res, 200, {
        user_id: id,
        user_info: {
          user_id: id,
          user_email: user.email,
          user_role: user.role,
          spend: members.get(id)?.spend ?? 0,
        },
        keys: [],
        teams: [],
      });
    }
    case "GET /key/list": {
      const rows = [...keys.values()].filter(
        (k) => !q.get("user_id") || k.userId === q.get("user_id"),
      );
      return reply(res, 200, {
        keys: rows.map(keyRow),
        total_count: rows.length,
        current_page: 1,
        total_pages: 1,
      });
    }
    case "GET /key/info": {
      const row = [...keys.values()].find((k) => k.token === q.get("key"));
      return row
        ? reply(res, 200, { key: row.token, info: keyRow(row) })
        : notFound(res);
    }
    case "POST /user/new": {
      const id = str(body.user_id);
      users.set(id, {
        email: str(body.user_email).toLowerCase(),
        role: "internal_user",
      });
      // No auto-created key (LT17).
      return reply(res, 200, {
        user_id: id,
        user_email: str(body.user_email),
        key: null,
      });
    }
    case "POST /team/member_add": {
      const member = (body.member ?? {}) as Json;
      const id = str(member.user_id);
      if (!users.has(id)) return notFound(res);
      members.set(id, {
        spend: 0,
        maxBudget: num(body.max_budget_in_team),
        rpm: null,
        tpm: null,
      });
      return reply(res, 200, {
        team_id: FAKE_LITELLM_TEAM_ID,
        updated_users: [],
        updated_team_memberships: [],
      });
    }
    case "POST /team/member_update": {
      const id = str(body.user_id);
      const member = members.get(id);
      if (!member) return notFound(res);
      if (body.max_budget_in_team !== undefined) {
        member.maxBudget = num(body.max_budget_in_team);
      }
      if (body.rpm_limit !== undefined) member.rpm = num(body.rpm_limit);
      if (body.tpm_limit !== undefined) member.tpm = num(body.tpm_limit);
      return reply(res, 200, { user_id: id, team_id: FAKE_LITELLM_TEAM_ID });
    }
    case "POST /team/member_delete":
      members.delete(str(body.user_id));
      return reply(res, 200, {});
    case "POST /key/generate": {
      const value = `sk-${randomBytes(16).toString("hex")}`;
      const token = createHash("sha256").update(value).digest("hex");
      keys.set(token, {
        value,
        token,
        userId: str(body.user_id),
        alias: typeof body.key_alias === "string" ? body.key_alias : null,
        blocked: false,
        spend: 0,
      });
      return reply(res, 200, { key: value, token, token_id: token });
    }
    case "POST /key/block":
    case "POST /key/unblock": {
      const row = keys.get(str(body.key));
      if (!row) return notFound(res);
      row.blocked = route === "POST /key/block";
      return reply(res, 200, { token: row.token });
    }
    case "POST /key/delete": {
      const tokens = Array.isArray(body.keys) ? body.keys : [];
      for (const token of tokens) keys.delete(str(token));
      return reply(res, 200, {});
    }
    default:
      return notFound(res);
  }
}

if (SERVICE_KEY === "") {
  process.stderr.write("fake LiteLLM: PROBE_FAKE_SERVICE_KEY is not set\n");
  process.exit(1);
}

createServer((req, res) => {
  handle(req, res).catch(() => reply(res, 500, { error: "fake failure" }));
}).listen(FAKE_LITELLM_PORT, "127.0.0.1");
