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
