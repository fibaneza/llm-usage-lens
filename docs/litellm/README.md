# LiteLLM contract snapshot

`openapi.json` is LiteLLM's published OpenAPI document, committed unmodified
as the contract for the dashboard's LiteLLM gateway
([LiteLLM spec](../specs/2026-11-10-litellm.md) — *Contract snapshot and
version pin*).

| Field | Value |
|---|---|
| Source | <https://docs.litellm.ai/openapi.json> |
| Fetched | 2026-11-10 |
| `openapi` | `3.1.0` |
| `info.version` | `1.108.3` |
| Paths | 717 |
| SHA-256 | `aed298fe64c20b0bd2ad3b637a3f513943152431de9a1c11025d3f5ce63d0dcc` |

Verify: `shasum -a 256 docs/litellm/openapi.json`.

**Refreshing** is a deliberate change: download the new document, diff the
paths and schemas the gateway uses, update this table and the spec, and
re-run the contract tests (unit L2). The file repeats one example key hash and
the placeholder `your_api_key_here` from LiteLLM's public docs;
`.gitleaks.toml` allows those exact, anchored values only.

## `allowed_routes` on the service key — observed behaviour (1.109.1)

Tested 2026-11-15 against the local LiteLLM OSS **1.109.1** (the snapshot above
is still 1.108.3; its refresh is due before L2). The canonical route list is
[runbook §3](../guides/litellm-admin.md); this section records how LiteLLM
matches it. The open points below are pending a spec decision (LiteLLM spec
— LD4); until then the spec and runbook are unchanged.

### How LiteLLM matches a key's `allowed_routes`

From `litellm/proxy/auth/route_checks.py`
(`RouteChecks.is_virtual_key_allowed_to_call_route`). An empty list means
**no restriction**. Otherwise a request is allowed when an entry is:

| Entry form | Matches | Example |
|---|---|---|
| Exact path | the path **and every path below it** (`route.startswith(entry + "/")`) | `/models` also admits `/models/{model_id}` |
| Route-group name | every route in that `LiteLLMRoutes` group | `management_routes` (never used: far too broad) |
| Trailing `*` | every path starting with the prefix | `/team/*` admits `/team/delete` |

There is **no** `{placeholder}` matching and **no** mid-path `*`. Refused
calls return `403` "Virtual key is not allowed to call this route".

### Configuration applied (local, dev)

The service key belongs to a `proxy_admin` user (LD3), with the 26 routes of
runbook §3. The three templated entries were tried in both forms; neither
matches:

```json
["/team/new","/team/update","/team/info","/team/list","/team/member_add","/team/member_update","/team/member_delete","/team/{team_id}/member/{user_id}/reset_spend","/team/{team_id}/member/{user_id}/reset_budget","/team/daily/activity/aggregated","/user/new","/user/info","/user/list","/user/daily/activity","/key/generate","/key/update","/key/delete","/key/block","/key/unblock","/key/info","/key/list","/key/{key}/regenerate","/spend/logs/v2","/models","/global/spend/report","/audit"]
```

Apply or change it with the master key (never the service key):

```sh
curl -sS -X POST "$LITELLM/key/update" -H "Authorization: Bearer $MASTER_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"key":"<service key>","allowed_routes":[ …the list above… ]}'
```

### Results

| Check | Result |
|---|---|
| Allowlisted reads (`/team/list`, `/user/list`, `/key/list`, `/models`) | `200` |
| Not allowlisted (`/model/info`, `/global/spend`, `/team/delete`, `/user/delete`, `/key/bulk_update`, `/key/regenerate`, `/key/{key}/reset_spend`, `/team/model/add`) | `403`, so the restriction is enforced on OSS |
| `/team/{team_id}/member/{user_id}/reset_spend` and `…/reset_budget`, written as `{…}` or as `/team/*/member/*/…` | `403`: unreachable |
| `/key/{key}/regenerate`, either form | `403`: unreachable; Enterprise-only in any case (OSS answers `500`) |

### Open points (pending a spec decision)

1. **Templated routes.** The only entries that reach them are `/team/*` and
   `/key/*`, which admit 34 and 15 paths (including `/team/delete`,
   `/key/bulk_update`); LD4 forbids that. Until decided, member reset-spend and
   reset-budget cannot work, and the connection test reports "service key routes
   out of date". Key rotation on OSS already composes generate + block.
2. **`/models` admits inference.** By the prefix rule it also matches
   `/models/{model_name}:generateContent`, `:streamGenerateContent` and
   `:countTokens`. A `:countTokens` call passed the route gate. With
   `models: []` the key is not restricted to any model list. Mitigate by removing
   `/models` from the key if no enabled operation needs it, or by restricting the
   key's models.
3. **Read-only prefix spill.** `/user/daily/activity` also admits its
   `/aggregated/*` and `/export` routes; `/team/daily/activity/aggregated`
   admits `/keys`, `/search` and `/model_top_keys`; `/audit` admits
   `/audit/{id}`. They are reads within the service key's purpose, but wider
   than the gateway allowlist.
