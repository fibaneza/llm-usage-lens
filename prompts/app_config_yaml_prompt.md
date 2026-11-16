# App Config File Prompt — configure the dashboard from `config.yaml` (unit CFG)

You are a **worker session** under the coordinator
(`prompts/coordinator_prompt.md`). You orchestrate agents through the
Rule 70 loop; you write no production code or tests yourself.

Primary checkout: `/Users/fibanez/Projects/aws-bedrock-cost-tracker` (`$REPO`).
Read specs, rules and state from `$REPO` (`main`). Never edit in the primary
checkout, on `main` or in another session's worktree.

**Precedence:** `CLAUDE.md` → `.claude/rules/00–70` → `docs/specs/**` →
`prompts/shared-contracts.md` → `prompts/coordinator_prompt.md` → this file.
This file never overrides a rule. Where it disagrees with a spec, the spec
is amended first (§4, step 1) — never diverge silently (Rule 00.2).

## 1. What the user asked for (2026-11-16)

> "generate a goal prompt to configurate the app from a config.yaml, the
> configuration from this file is top priority over database configuration
> as litellm does. The file is loaded at startup and include in the docker"

Four requirements, each with its test in §5:

1. **One file, `config.yaml`,** configures the app.
2. **The file wins.** A value set in the file overrides the value stored in
   the database (DynamoDB) for the same setting.
3. **Loaded at startup.** The file is read and validated once when the
   server starts; a bad file stops the start.
4. **Included in the Docker image.**

**Clarified by the user the same day:**

> "The plan of this config.yaml is not replacing .env although some config
> from .env can be moved. This config.yaml is to configuate default values
> as, guardrails, team permissions, and other org configs."

So:

5. **`.env` stays.** `config.yaml` does not replace `env.ts` / `.env`.
   Secrets and deployment wiring remain environment variables. A
   non-secret, organisation-level value that lives in `.env` today **may**
   move to the file; each move is listed in the inventory with its reason,
   and the variable keeps working for one release as a fallback so no
   deployment breaks.
6. **What the file is for:** the organisation's configuration — the
   LiteLLM **guardrails**, **team permissions** (what a team role may see
   and do) and **other organisation settings** (display name, retention,
   visibility defaults and the like). It is the baseline an operator ships
   with the image, and where it sets a value, that value wins (item 2).

## 2. What already exists — do not rebuild it

| Thing | Where | Note |
|---|---|---|
| Env validation | `apps/dashboard/env.ts` (`@t3-oss/env-nextjs`, Zod) | Stays. Secrets and deployment wiring remain environment variables (Rule 50.2). |
| A first config file | `apps/dashboard/config/litellm-gateway.json`, loaded by `lib/litellm/gateway-config.ts`, schema `LiteLLMGatewayConfigSchema` in `packages/shared` | Parsed at module load, fails startup on an invalid value (LiteLLM spec — *Guardrail configuration*, LD19). Narrow-only: it can switch an operation off, never on. |
| Its precedence today | LiteLLM spec LD19 | **UI (saved `OperationToggles`) > file > LD10.** The user's new decision reverses the first two for file-set values. This is the one known spec conflict — see §3. |
| Settings stored in DynamoDB | `lib/data/litellm/{connection,toggles,team-links}.ts`, `lib/data/access/{visibility,group-mappings,identity-map-rules,sso-binding,per-user-approval}.ts`, `lib/data/account-meta.ts`, data retention | Each has a Settings panel and audited write routes. |
| Image build | `apps/dashboard/Dockerfile` (Next.js `standalone` output, three stages), task definition in `infra/lib/dashboard-service/task.ts` | The runner stage copies only `.next/standalone`, `.next/static` and `public`. |

## 3. Decisions

**Decided by the user (2026-11-16) — record in the spec as user decisions:**

- D1. The file's value wins over the database value for the same setting.
- D2. The file is loaded once at startup.
- D3. The file ships inside the Docker image.

**Agent decisions — decide by common practice, record with the reason, report
(Rule 00.3):**

- A1. **Precedence, complete:** `config.yaml` > database (Settings UI) >
  built-in default. A setting the file does not mention behaves exactly as
  today.
- A2. **Format and library:** YAML 1.2, parsed with the `yaml` package
  (new dependency of `apps/dashboard`; add it to the Design System spec
  stack list and Rule 40). Safe parsing only: no custom tags, no merge-key
  tricks, a size cap, duplicate keys are an error.
- A3. **Location:** `apps/dashboard/config/config.yaml`, checked in. An
  optional `APP_CONFIG_FILE` variable (in `env.ts`) points at another path
  for a mounted file; unset means the baked-in file.
- A4. **Validation:** one Zod schema in `packages/shared`
  (`AppConfigSchema`, strict: unknown keys fail). Invalid file, unreadable
  file named by `APP_CONFIG_FILE`, or a secret-shaped key → the server does
  not start, with a message that names the key path and never echoes a
  value (Rule 60.19, Rule 50.6).
- A5. **No behaviour change on merge.** The checked-in file carries only
  what `litellm-gateway.json` carries today (A8); every other key is
  present as a comment that documents it. An empty file is also valid.
- A6. **Locked settings in the UI.** A setting set by the file shows its
  effective value with a "Set in config.yaml" source badge and its controls
  disabled. Extend the existing source model (`ui | file | spec`) rather
  than inventing a second one.
- A7. **Locked settings in the API.** A write to a file-set setting returns
  `409` with code `CONFIG_FILE_LOCKED` in the standard error shape, after
  the session and permission checks and before any DynamoDB write, with one
  `denied` audit record. The stored value is left untouched, so removing
  the key from the file restores it.
- A8. **Reuse the existing file, converted to YAML (user, 2026-11-16).**
  `apps/dashboard/config/litellm-gateway.json` is not kept beside a second
  file: it is converted and becomes `apps/dashboard/config/config.yaml`.
  Its current content moves, value for value, under `litellm.operations`,
  and `LiteLLMGatewayConfigSchema` becomes that branch of
  `AppConfigSchema`. The JSON file and its import are deleted in the same
  commit (no fallback reader); `lib/litellm/gateway-config.ts` keeps its
  exported `loadGatewayConfig()` and reads the branch from the new loader,
  so callers do not change. A test proves the converted file yields exactly
  the gateway config the JSON yielded.
- A10. **Moved `.env` values.** For a value that moves: file > environment
  variable > default, with the variable marked deprecated in `env.ts` and
  `.env.example`. Secrets, the identity-provider settings, `APP_ENV`, the
  dev-login switch and AWS wiring never move.
- A9. **Dev and tests.** `pnpm dev`, Vitest and Playwright read the same
  loader; tests pass a fixture path through `APP_CONFIG_FILE`. No
  hot-reload: changing the file needs a restart (D2).

**The user's decisions — ask, do not decide (implementation-phases —
*Decision policy*: security and the test bar are the user's):**

- Q1. **May the file widen the LiteLLM gateway?** Today configuration is
  narrow-only (LD19): the file may set `enabled: false`, never `true`.
  Recommended: keep narrow-only — "the file wins" then means the UI cannot
  re-enable what the file switched off. Until answered, keep narrow-only.
- Q2. **How far do "team permissions" go?** In scope by the user's word:
  the permission *policy* — what each team-level role (lead, member,
  org-admin, auditor) may see and do, and the visibility defaults. Open:
  whether the file may also name *who* holds a role — role grants, admin
  scopes, affiliations, identity links, group mappings, password users, the
  master user. Recommended: no — assignments stay database-only, audited
  and versioned, and the file can never grant a global role (Rule 50.4,
  Access Control spec — *Enforcement*, *Permission matrix*). Until
  answered, the schema accepts policy keys and rejects assignment keys. A
  policy value may only narrow the spec's permission matrix, never widen it,
  unless the user says otherwise with Q1.
- Q3. **Which settings are in scope for v1?** Recommended list, to confirm:
  LiteLLM guardrails (operation toggles and the other guardrail settings),
  team permission policy and visibility defaults, organisation display
  name, LiteLLM connection base URL (never the key), allowed LiteLLM hosts,
  data retention, session-lifetime values that are settings today. Step 1
  produces the real inventory — including each `.env` value proposed to
  move — and the user confirms it before code.

**Never in the file, whatever the answers:** secrets and key material
(`AUTH_SECRET`, OAuth client secret, `LITELLM_SERVICE_KEY`, master password
hash, TOTP secret, KMS key id), AWS account IDs other than the documented
placeholders (Rule 50.9), and anything that selects the identity provider
or enables dev login (those stay in `env.ts`, fail closed).

## 4. The unit

**CFG — app config file.** Branch `feature/app-config-yaml`, worktree
`.claude/worktrees/app-config`, branched from the latest `main`. One branch,
one squash commit (Rule 30.4). It is not in the phase plan today, so it
starts with a spec change (Rule 00, Rule 30).

**Place in the queue:** after the Settings admin area (unit D of
`litellm_role_views_prompt.md`) and after L3d, because the locked-state UI
sits on the new Settings tabs and the toggle precedence touches L3d's
routes. Step 1 (spec and inventory) may run earlier; it changes no code.

Steps, in order:

1. **Spec first.** One opus agent:
   - inventories every setting the app stores in DynamoDB and every
     non-secret `env.ts` value, in `temp/run-config/inventory.md` (setting,
     where stored, who may write it, proposed YAML key, in or out of v1 and
     why);
   - drafts the amendment: a new *Configuration file* section (System
     Architecture or Platform spec — pick the one that owns runtime
     configuration and say why), the LD19 precedence change in the LiteLLM
     spec, the Data Model note that a file-set value shadows the stored
     item, the Platform spec's image contents, the Design System stack line,
     a new unit block with a Verify checklist in implementation-phases, and
     the threat items in §6;
   - stops for the user's answers to Q1–Q3 (send the coordinator
     `blocked cfg: decisions Q1–Q3`), then applies the amendment.
   `spec-guardian` reviews it at the unit review.
2. **Red.** `tdd-test-engineer` (sonnet) writes the failing suite of §5.
3. **Green.** `typescript-developer` (sonnet):
   - `packages/shared`: `AppConfigSchema` and its inferred type;
   - `apps/dashboard/lib/config/app-config.ts` (`import "server-only"`):
     reads the file once at module load, validates, freezes, exports typed
     accessors and `isFileSet(keyPath)`;
   - one resolver per in-scope setting, so the precedence lives in one
     place and the data-access functions keep trusting typed inputs;
   - the `409 CONFIG_FILE_LOCKED` guard in the affected write routes
     (through `withRoute`, registered in the shared route-contract suite);
   - the source badge and disabled controls in the affected Settings panels;
   - `Dockerfile`: copy the file into the runner stage at the path the
     loader reads, owned by the `app` user, read-only; confirm the
     `standalone` output does not need `outputFileTracingIncludes`, or add
     it;
   - `infra/`: only if the task definition must set `APP_CONFIG_FILE`;
     `cdk synth` must stay clean. Deploying is the user's action.
4. **Branch gate** (Rule 70.12): `pnpm typecheck`, `pnpm lint`,
   `pnpm format:check`, `pnpm exec vitest run --changed $(git merge-base main HEAD)`,
   the targeted e2e specs, `pnpm build:ci`, and
   `pnpm --filter @llm-usage-lens/infra synth` if `infra/` changed.
   A local `docker build` of the dashboard image plus a check that the file
   is at the expected path inside it — if Docker is unavailable, say so in
   the report instead of skipping silently.
5. **Docs.** `.env.example` (`APP_CONFIG_FILE`), `docs/guides/operations.md`
   (how to change configuration: edit the file, rebuild, redeploy; what
   needs a restart), `docs/guides/dashboard-deployment.md`, `README.md`.
6. **Report and stop** (§7). The coordinator runs the review, which
   includes a dedicated security review for this unit.

## 5. Tests (red first; every case cites its spec line or threat item)

Lowest layer that can see the defect, once (Rule 60.24a):

- **Schema** (`packages/shared`): valid minimal and full files; unknown key,
  wrong type, duplicate key, secret-shaped key, authorization key (Q2),
  `enabled: true` on an operation (Q1) — each rejected.
- **Loader** (unit): missing default file → empty config; missing file named
  by `APP_CONFIG_FILE` → throws; invalid file → throws with the key path and
  no value in the message; oversize file → throws; loaded once (a changed
  file is not re-read).
- **Precedence** (integration, DynamoDB Local): for each in-scope setting —
  file only, database only, both (file wins), neither (default); removing
  the key from the file restores the stored value.
- **Routes**: a write to a file-set setting returns `409
  CONFIG_FILE_LOCKED`, writes nothing, records one `denied` audit; `401` and
  `403` still come first; a write to a setting the file does not set still
  succeeds. Register in the shared route-contract suite.
- **Components**: a file-set setting renders the badge and disabled
  controls; a database-set one is editable.
- **e2e** (one spec, headless): with a fixture file, the Settings panel shows
  the locked setting and its value; the app starts with the checked-in file.

## 6. Threat items to add to the spec

- **Config file as a privilege path.** The file cannot grant a role, widen
  the gateway or disable sign-in protections (Q1, Q2, the "never" list).
- **Secrets in an image layer.** The schema rejects secret-shaped keys;
  gitleaks stays green on the checked-in file.
- **Silent drift.** The UI shows the source of every effective value;
  startup logs the list of file-set key paths (names only) through
  OpenTelemetry, never values.
- **Parser attacks.** Safe YAML parsing, size cap, no custom tags.
- **Stale UI writes.** A locked write is refused on the server, not only
  disabled in the browser.

## 7. Ownership, guards and run discipline

- **Shared, append-only — send `overlap cfg: <path>` to the coordinator
  before editing:** `apps/dashboard/env.ts`, `.env.example`,
  `apps/dashboard/Dockerfile`, `infra/lib/dashboard-service/task.ts`.
- **Owned by `litellm_prompt` — send `overlap` and wait:**
  `lib/litellm/gateway-config.ts`, `config/litellm-gateway.json`, the LD19
  text.
- **Owned by their units:** the settings reads under `lib/data/**`; the
  Settings panels (unit D) and LiteLLM panels (unit A).
- Role boundaries of Rule 70.8 hold. Name the model on every dispatch.
  Results, not logs. Check usage before each dispatch
  (`jq '.rate_limits' ~/.claude/usage-snapshot.json`): caution at 60% of
  the 5-hour window, no new agents at 75% — then log and send `frozen cfg`.
- **Never** merge into `main`, never push, never bypass a hook, never
  deploy, never commit `temp/` or a real AWS account ID.
- Run folder `temp/run-config/` (inventory, progress, logs, report).
  Messages to the coordinator are one line: `progress`, `blocked`,
  `overlap`, `frozen`, `ready to merge cfg at <commit>`.

## 8. Completion criteria

The run is complete when all of these hold, or when it ends on a usage
freeze or an unanswered user decision with the report written:

1. Specs amended and consistent; Q1–Q3 answered by the user and recorded.
2. The checked-in `config.yaml` exists, holds the converted content of
   `litellm-gateway.json` and nothing else, and documents every key; the
   JSON file is gone.
3. §5 suite green; the branch gate green on the branch with `main` merged
   in; the image contains the file (or Docker's absence is reported).
4. A file-set setting wins over the database, is locked in UI and API, and
   reverts when the key is removed — shown by tests, not asserted in prose.
5. No secret, role or account ID can be set through the file.
6. `temp/report_<yymmdd>_config.md` written: what changed, decisions made
   and why, test counts, what was not verified, open questions.
7. `ready to merge cfg at <commit>` sent. The user approves the merge.

`/goal` line:

```
/goal prompts/app_config_yaml_prompt.md §8 completion criteria met, and the report written — or the run ended by a usage freeze or an unanswered user decision, with the report written.
```
