# LiteLLM contract snapshot

`openapi.json` is LiteLLM's published OpenAPI document, committed unmodified
as the contract for the dashboard's LiteLLM gateway
([LiteLLM spec](../specs/2026-11-10-litellm.md) — *Contract snapshot and
version pin*).

| Field | Value |
|---|---|
| Source | the local LiteLLM 1.109.1 `http://localhost:4000/openapi.json` (previously <https://docs.litellm.ai/openapi.json>, 1.108.3) |
| Fetched | 2026-11-15 |
| `openapi` | `3.1.0` |
| `info.version` | `1.109.1` |
| Paths | 729 |
| SHA-256 | `b4c4e4648e8ecc477529f900f0fa2c30e6ba38ecd7089292b50d4212c5bc3ae5` |

Verify: `shasum -a 256 docs/litellm/openapi.json`.

**Refreshing** is a deliberate change: download the new document, diff the
paths and schemas the gateway uses, update this table and the spec, and
re-run the contract tests (unit L2). The refresh to **1.109.1** is due at
the start of L2; on the 26 allowlisted routes the only difference found is
that `tpm_limit` and `rpm_limit` gained `minimum: 0`. The file repeats one
example key hash and the placeholder `your_api_key_here` from LiteLLM's
public docs; `.gitleaks.toml` allows those exact, anchored values only.

## Service key `allowed_routes` on LiteLLM 1.109.1

Tested on 2026-11-15 against a local LiteLLM OSS 1.109.1. The route list
itself lives in [runbook §3](../guides/litellm-admin.md). The decisions it
led to are in the LiteLLM spec: LD4 (temporary wildcards), LD18 (no
inference) and *Gateway guardrails*. This section records the observed
behaviour behind them.

### How LiteLLM matches an entry

Source: `litellm/proxy/auth/route_checks.py`,
`RouteChecks.is_virtual_key_allowed_to_call_route`. An **empty** list means
no restriction at all. Otherwise a request is allowed when any entry
matches:

| Entry form | Matches | Example |
|---|---|---|
| Path | that path **and every path below it** (`route.startswith(entry + "/")`) | `/models` also admits `/models/{model}:generateContent` |
| Route-group name | every route in that `LiteLLMRoutes` group | `management_routes` (never used: far too broad) |
| Trailing `*` | every path that starts with the prefix | `/team/*` admits `/team/delete` |

There is **no** `{placeholder}` matching and **no** mid-path `*`. A refused
call returns `403` "Virtual key is not allowed to call this route".

### Templated routes need the wildcards

The three templated operations cannot be allowed by an exact entry:

| Entry tried | `/team/<id>/member/<id>/reset_spend` |
|---|---|
| `/team/{team_id}/member/{user_id}/reset_spend` | refused |
| `/team/*/member/*/reset_spend` | refused |
| `/team/*` | allowed |

The same holds for `reset_budget` and for `/key/{key}/regenerate`, which
only `/key/*` reaches. The regenerate route is Enterprise-only; OSS answers
`500` "Enterprise feature", and OSS key rotation is the composed
generate-then-block (LiteLLM spec — `rotateKey`).

### The applied configuration

The applied configuration is the list of 26 routes from [runbook §3](../guides/litellm-admin.md):

```json
["/team/new","/team/update","/team/info","/team/list","/team/member_add","/team/member_update","/team/member_delete","/team/*/member/*/reset_spend","/team/*/member/*/reset_budget","/team/daily/activity/aggregated","/user/new","/user/info","/user/list","/user/daily/activity","/key/generate","/key/update","/key/delete","/key/block","/key/unblock","/key/info","/key/list","/key/*/regenerate","/spend/logs/v2","/models","/global/spend/report","/audit"]
```

Decided on 2026-11-15 (LD4). The key carries the runbook §3 list, in which
`/team/*` and `/key/*` replace the three templated entries for now:

```json
["/team/new","/team/update","/team/info","/team/list","/team/member_add","/team/member_update","/team/member_delete","/team/*","/team/daily/activity/aggregated","/user/new","/user/info","/user/list","/user/daily/activity","/key/generate","/key/update","/key/delete","/key/block","/key/unblock","/key/info","/key/list","/key/*","/spend/logs/v2","/models","/global/spend/report","/audit"]
```

The exact `/team/…` and `/key/…` entries are redundant while the wildcards
are present. They stay so that removing the wildcards later is the only
change (future-improvements — *Exact templated `allowed_routes`*).

Apply or change it with the **master key**, never the service key:

```sh
curl -sS -X POST "$LITELLM/key/update" -H "Authorization: Bearer $MASTER_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"key":"<service key>","allowed_routes":[ …the list above… ]}'
```

### Results with the exact list (before the wildcards)

| Check | Result |
|---|---|
| Allowlisted reads (`/team/list`, `/user/list`, `/key/list`, `/models`) | `200` |
| Not allowlisted (`/model/info`, `/global/spend`, `/team/delete`, `/user/delete`, `/key/bulk_update`, `/key/regenerate`, `/key/{key}/reset_spend`, `/team/model/add`) | `403`: the restriction is enforced on OSS |
| Member `reset_spend` and `reset_budget`, as `{…}` or `/team/*/member/*/…` | `403`: unreachable |
| `/key/{key}/regenerate`, either form | `403`: unreachable |

### What the list admits beyond the gateway, and how that is handled

| Admitted | Why | Handling |
|---|---|---|
| `/team/*`: 34 paths, `/key/*`: 15 paths, including `/team/delete`, `/team/model/add`, `/key/bulk_update` | Trailing wildcards (LD4, temporary) | *Gateway guardrails*: one outbound choke point, validated path parameters, a hard-limit denylist test, exact bodies, write toggles, and a warning on the Settings → LiteLLM panel |
| `/models/{model}:generateContent`, `:streamGenerateContent`, `:countTokens` (a `:countTokens` call passed the route gate) | The `/models` prefix rule, with a key that has `models: []` | **LD18**: a key setting must refuse inference while `GET /models` still lists names. L2 verifies which one and records it in the runbook |
| `/user/daily/activity/aggregated/*` and `/export`; `/team/daily/activity/aggregated/keys`, `/search` and `/model_top_keys`; `/audit/{id}` | The prefix rule on read routes | Accepted: they are reads within the key's purpose, and the gateway never calls them |

### Re-test after any change to the key

1. Allowlisted reads return `200`. A hard-limit route the wildcards do not
   cover (for example `/model/info`) returns `403`.
2. A model call with the service key is refused (LD18).
3. The dashboard connection test passes, and while the wildcards are
   present it shows the temporary-wildcard warning.
