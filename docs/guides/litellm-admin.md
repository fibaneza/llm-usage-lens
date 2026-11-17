# LiteLLM administration runbook

Operator and user steps for connecting LLM Usage Lens to an existing LiteLLM
proxy. The design is in the [LiteLLM spec](../specs/2026-11-10-litellm.md);
general operations (alarms, redeploys) are in [operations.md](operations.md).
Nothing here is automated by the dashboard, and the dashboard never holds the
LiteLLM master key.

## 1. Prerequisites (user)

- The company's LiteLLM is **≥ 1.104.0** (`reset_budget`; past the
  CVE-2026-47101 `allowed_routes` fix in 1.83.14). **Confirmed 2026-11-10:**
  the company runs the latest release. **Version 1.109.0** (user,
  2026-11-14); update this line at each upgrade.
- At each LiteLLM upgrade, check the LiteLLM security advisories for the new
  version and note the date checked here.
- `dev` runs LiteLLM OSS (no SSO); `prod` runs LiteLLM Enterprise with Entra
  ID SSO. The dashboard derives the edition from `APP_ENV`.
- The internal hostname and port of LiteLLM. It runs on ECS in the same
  subnets as the dashboard; its security group must accept that port from
  the dashboard task security group (the stack output `TaskSecurityGroupId`),
  never from the subnet range. The dashboard never connects to LiteLLM's
  Aurora PostgreSQL database.
- **LiteLLM audit logging** (LiteLLM spec — *Audit*, LD14/LD15): the
  operators enable LiteLLM's audit-log storage in the proxy `config.yaml`:

  ```yaml
  litellm_settings:
    store_audit_logs: true
  ```

  (per the LiteLLM docs; confirm on 1.109.0 that the key sits under
  `litellm_settings` and whether it needs Enterprise). Without it, the
  `litellm-changed-by` attribution is not stored and the dashboard's
  *LiteLLM audit* section stays empty. Record the date enabled here:
  `<date>`.

## 2. Create the dashboard service user and key (LiteLLM operators)

Run with the **master key**, from an operator workstation, never from the
dashboard, its CI or its AWS account. `$LITELLM` is the proxy base URL.

1. Create the service user:

   ```sh
   curl -sS -X POST "$LITELLM/user/new" \
     -H "Authorization: Bearer $MASTER_KEY" -H 'Content-Type: application/json' \
     -d '{"user_id":"svc-llm-usage-lens","user_role":"proxy_admin",
          "auto_create_key":false,"send_invite_email":false}'
   ```

2. Create its key, with `allowed_routes` set to **exactly** the list in §3
   and a `key_alias`. The key must not be able to call any model (LiteLLM
   spec LD18): `/models` also matches `/models/{model}:generateContent` as a
   prefix, and a key with no `models` may call every model. L2 records here
   the key setting verified to refuse inference while `GET /models` still
   lists names; until then, do not hand the key to anything but the
   dashboard:

   ```sh
   curl -sS -X POST "$LITELLM/key/generate" \
     -H "Authorization: Bearer $MASTER_KEY" -H 'Content-Type: application/json' \
     -d '{"user_id":"svc-llm-usage-lens","key_alias":"llm-usage-lens-<env>",
          "allowed_routes":[ …the §3 list… ]}'
   ```

   The response's `key` is shown once. Put it straight into SSM (§4); do not
   save it anywhere else.

3. **Verify the restriction.** With the new key, a non-allowlisted read such
   as `GET /model/info` must return `403`, and `GET /team/list` must return
   `200`. Also confirm whether the templated routes in §3 (`{team_id}`,
   `{user_id}`, `{key}`) match as written; if LiteLLM needs a pattern form,
   record the form used here and tell the dashboard maintainers (the
   allowlist test compares this list with the gateway).

4. **Hardening recommendation.** Review the proxy's route-restriction
   settings (for example any admin-only route configuration) so that
   ordinary user keys cannot reach management routes.

## 3. `allowed_routes` (must equal the gateway allowlist)

```
/team/new
/team/update
/team/info
/team/list
/team/member_add
/team/member_update
/team/member_delete
/team/*            (temporary; covers /team/{team_id}/member/{user_id}/reset_spend and /reset_budget)
/team/daily/activity/aggregated
/user/new
/user/info
/user/list
/user/daily/activity
/key/generate
/key/update
/key/delete
/key/block
/key/unblock
/key/info
/key/list
/key/*             (temporary; covers /key/{key}/regenerate)
/spend/logs/v2
/models
/global/spend/report
/audit
```

**Why the two wildcards (temporary, 2026-11-15).** LiteLLM 1.109.1 matches
`allowed_routes` only exactly, by prefix, by group or with a trailing `*`;
`{team_id}` and `{key}` templates never match. `/team/*` and `/key/*` are
the only way to allow the three templated operations, and they also allow
hard-limit routes, so the dashboard's gateway guardrails refuse those
(LiteLLM spec — *Gateway guardrails*) and the Settings → LiteLLM panel
shows a warning while they are present. Replace them with the exact
templated routes once LiteLLM supports them (future-improvements).

## 4. Store the key in SSM (user, by hand)

```sh
aws ssm put-parameter --name /llm-usage-lens/<env>/litellm/service-key \
  --type SecureString --key-id <project CMK ARN or alias> --value '<key>'
```

- Standard tier (no charge); encrypted with the project CMK, which the task
  execution role can already decrypt (the CMK's usage is an accepted,
  existing cost).
- No CDK, script or app code writes this parameter; the DashboardServiceStack only
  references its ARN in the task definition's `secrets`.
- Keep the value out of shell history (for example, read it from a prompt).

## 5. Configure the dashboard (user)

1. Set the CDK context `litellmAllowedHosts` (it becomes the container
   environment variable `LITELLM_ALLOWED_HOSTS`) to the LiteLLM
   hostname only (with `:port` if not 443).
2. Ask the LiteLLM operators to allow the LiteLLM port on LiteLLM's
   security group from the dashboard task security group (stack output
   `TaskSecurityGroupId`); no dashboard-side rule is needed.
3. Deploy the DashboardServiceStack (`cdk deploy`, user action).
4. As `internal-admin`, open **Settings → LiteLLM**: enter the `https` base
   URL, run the connection test (it must report `ok` before the URL saves),
   check the edition shown, then link dashboard teams to LiteLLM teams.
5. Review the operation toggles. The destructive operations (reset member
   spend, delete key) and self-service key requests start **off**; remove
   member starts **on** (LiteLLM spec LD10, amended 2026-11-14).

## 6. Rotate the service key

1. Create a new service key (§2 step 2) with the same `allowed_routes`.
2. Update the SSM parameter by hand (§4, with `--overwrite`).
3. Force a new ECS deployment so new tasks read it — ECS resolves
   `valueFrom` only at task start:
   `aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment`.
4. Run the connection test in Settings.
5. Block, then delete, the old key in LiteLLM (`/key/block`, `/key/delete`,
   with the master key).

Connection-test results: `unauthorised` means LiteLLM returned `401` — the
service key was rejected: rotate and redeploy (the dashboard never retries
with another key). `routes out of date` means a `403` on an allowlisted
route — compare the key's `allowed_routes` with §3.

## 7. Edition change and identity links

Changing a deployment's edition (OSS ↔ Enterprise) changes how LiteLLM user
ids are assigned. After the change, an `internal-admin` re-resolves the
identity links (`litellmUserId`) in Settings; each re-link is audited.

**Confirmed 2026-11-10:** on the company's Enterprise deployment, the
`user_id` LiteLLM assigns at SSO sign-in is the **email**. The dashboard
still looks the user up by email and stores the `user_id` LiteLLM returns.
If LiteLLM's SSO mapping is ever changed, re-resolve the links as above.

## 8. Gateway principals (for combined totals, L6)

Combined totals add direct Bedrock usage and LiteLLM-reported usage. When
LiteLLM calls Bedrock, that traffic is already in the Bedrock data, so the
dashboard must know which Bedrock usage is LiteLLM's (shared contract §5;
LiteLLM spec — *Combined usage and My usage (L6)*).

1. Identify, with the LiteLLM operators, the IAM role names LiteLLM uses to
   call Bedrock and, if LiteLLM runs in its own AWS account, that account
   id. These production values are a user decision (U2).
2. As `internal-admin`, open **Settings → LiteLLM → Gateway**
   (`/dashboard/settings/litellm/gateway`) and add:
   - **IAM role** principals by role name. A role matches the bare name, an
     `arn:aws:sts::<account>:assumed-role/<role>/<session>` key or an
     `arn:aws:iam::<account>:role/<path>/<role>` key, case-insensitively and
     exactly (never a substring).
   - **Usage key** principals for any other exact usage key, such as the
     `AROA…:<session>` form, which carries no role name.
   - **Account IDs** (12 digits) for an account whose whole Bedrock cost is
     LiteLLM's. The account must already be registered in Settings.

   A person's email is refused as a principal: excluding it would hide real
   usage. Every save is audited (`litellm.gateway.update`). The Auditor and
   `internal-org-admin` see the configuration read-only.
3. Check Overview → *Combined usage*: "Billed via LiteLLM" is the gateway
   slice, and the reconciliation row compares it with LiteLLM's reported
   Bedrock spend. A large difference usually means a missing or extra
   principal.

Until a principal or account id is configured, combined totals are hidden
from Viewers and Leads, and Admins, Auditors and org-admins see "gateway not
configured — totals may double count". The organisation's LiteLLM part
covers LiteLLM teams only (spend on keys outside any team is not included;
the user declined the proxy-wide read, U1, 2026-11-17).

## 9. Team links

A dashboard team reaches LiteLLM only through a team link. In **Management →
LiteLLM → LiteLLM teams** (moved from Settings → LiteLLM → Team links on
2026-11-17, management improvements D3; the old URL redirects), an
`internal-admin` or `internal-org-admin` (LD24) links a dashboard team to an
existing LiteLLM team, or removes the link. Both teams are picked from lists
(D4a); a team that already has a link cannot be picked. Every link write is
audited with the actor.

- Create the LiteLLM team in LiteLLM first (the LiteLLM UI or
  `POST /team/new` with an operator key), then link it here. The dashboard
  service key is never used for this.
- A write on an unlinked team returns `409 CONFLICT` "The team is not
  connected to LiteLLM" (LD26).
- `POST /api/litellm/teams` (create in LiteLLM and link, `internal-admin`
  only) is the **New LiteLLM team** action on the same tab (from unit M1,
  2026-11-17). If its link loses a race, the LiteLLM team it created stays in
  LiteLLM; remove it there by hand.

## 9a. App teams and LiteLLM teams

An **app team** is a dashboard team; a **LiteLLM team** is a team on the
proxy. UI copy says "team" only for the first (App Teams spec —
*Vocabulary*).

- **Linked** app teams have a team link (§9) to their own LiteLLM team. Their
  headline spend is the LiteLLM team's spend (LD29).
- **Unlinked** app teams have no link. Their headline spend is the member sum
  (below), badged "Sum of members". Their members may sit in any LiteLLM
  team, or none.
- **Linking.** An `internal-admin` or `internal-org-admin` links a team in
  Management → LiteLLM → LiteLLM teams (formerly Settings → LiteLLM → Team
  links), which has a "Spend source" column for
  every app team. A Lead cannot link: it would gain read and write over a
  LiteLLM team it may not own (LD30).
- **No LiteLLM controls on an unlinked team's page** (LD32): only app
  membership add and remove. Budgets, limits and keys are managed in LiteLLM
  or after linking.

### The two figures

- **LiteLLM team** figure: everything spent through that LiteLLM team's keys,
  including keys owned by people outside the app team.
- **Sum of members**: everything each app member spent through the gateway,
  in any LiteLLM team and on personal keys. Admin, org-admin and Auditor also
  see it on a linked team, beside the LiteLLM team figure; a Lead does not
  (LT28). From 2026-11-17 the figures are on **Usage → Team usage** (a Lead
  for its teams; Admin, org-admin and Auditor for any team) and, for the
  global readers, on Cost by team's LiteLLM panel; the Team page no longer
  shows spend (management improvements D7, MI-D7).
- The two differ for those reasons, and because membership is read as it is
  now: a person who moved app team carries earlier spend to the new team.
- Both are LiteLLM-reported, not billed cost; USD, UTC days. Billed cost
  stays in the AWS views.

### Coverage and unmatched members

Every member sum shows coverage: members, matched, unmatched and pending.
Pending affiliations are counted, not summed. An unmatched member shows "not
in LiteLLM", never $0. To fix one, either:

- link the identity's `litellmUserId` (§7), or
- make the LiteLLM user's email match the identity's verified email. A
  lookup result with a different email is dropped (LT24).

### Organisation page

Two tables, because the cuts do not add up to each other:

- **LiteLLM teams:** every proxy team, with spend, budget, members and its
  linked app team. **The headline total comes from this table** (LD33):
  summing app teams would count twice a member of an unlinked team who spends
  through a LiteLLM team linked to another app team.
- **App teams:** per app team, labelled as overlapping rows that do not add
  up to the total.
- One request makes at most 200 LiteLLM calls (LD34). Unlinked teams are
  summed smallest first; one that does not fit shows no spend with
  `open-team` and a link to its Team usage page
  (`/dashboard/team-usage?team=<id>`; the Team page until 2026-11-17, MI-D7),
  where its member sum is read on its own.

### Limits and errors

- More than 200 members: `422 TOO_MANY_MEMBERS`, with no LiteLLM call. At
  most 5 reads run at once (LD34).
- One failing member read fails the whole view with the LiteLLM error; there
  is no partial sum (LD35).
- `getUserDailySpend` switched off (§10): `403 OPERATION_DISABLED`.
- Under the Organisation cap (§14) per-member spend is hidden, but the team
  total is always shown (LD31). On a team of one or two members that nearly
  equals one person's cost; the user accepted this (LiteLLM spec — *Residual
  risks*).

## 9b. User links (management improvements D16, 2026-11-17)

In **Management → LiteLLM → LiteLLM users**, an `internal-admin` or
`internal-org-admin` links an app user to a LiteLLM user (never their own
identity):

- **Match found:** a LiteLLM user with the same verified email. Click
  *Link* and confirm the dialog that names both sides. Nothing is linked
  automatically.
- **No LiteLLM user with that email:** link to an existing LiteLLM user
  found by search, with a written reason (the emails differ), or, on OSS
  only, *Create and link* (`createUser`, `POST /user/new` with
  `auto_create_key:false`; toggle `createUser`, default on). On Enterprise
  the person signs in to LiteLLM once, then the admin retries the match.
- A LiteLLM user already linked to someone else, or holding a proxy role
  above `internal_user`, is refused. Usage identities and aliases stay in
  Settings → Access → Identities (`internal-admin`).
- The service key needs no new route: `/user/new` is already in
  `allowed_routes` (§3).

## 10. Operation toggles and guardrails

The toggles in Settings → LiteLLM and the gateway config file (LiteLLM spec —
*Guardrail configuration*) can only **narrow** what the gateway allows,
never widen it. An operation the allowlist lacks cannot be switched on.

- `internal-admin` and `internal-org-admin` change toggles (LD24); each
  change is audited and an Admin can reset it.
- The code-only guardrails (the allowlist, the request-body denylists, the
  connection host bound `LITELLM_ALLOWED_HOSTS`) have no switch.
- The connection (base URL, test) stays `internal-admin` only.

## 11. The team configuration page (Leads)

A Lead configures their own team's LiteLLM settings on the team
configuration page, **Management → Team**
(`/dashboard/manage/team?team=<teamId>`; the old
`/dashboard/litellm/team-config` URL redirects there). The Auditor sees it
read-only; Viewers and plain members get a `404`; a Lead sees only teams in
their scope.

- **Members:** add (from the dashboard team's members), remove, budget,
  limits, reset spend, reset budget, disable and enable.
- **Keys:** generate, update, block, unblock, delete, rotate.
- **Team:** budget and limits (a Lead and an `internal-org-admin` lower
  only; only an `internal-admin` sets or raises them, LD26), and models
  (restrict to a subset of the team's models only).

## 12. Keys

- **Shown once.** Generate and rotate return the key value once, in a
  dialog; the dashboard stores and logs only the token hash (`tokenId`). A
  lost value is not recoverable: rotate the key.
- **Rotation.** Enterprise uses LiteLLM regenerate with a grace period. OSS
  generates a new key with the old key's models, remaining expiry and
  blocked state, then blocks the old key; delete the old key once clients
  have moved.
- **Revocation.** Block a key to stop it at once (reversible with unblock);
  delete it when it is no longer needed (`deleteKey` toggle, off by
  default).
- A key or member owned by a privileged LiteLLM user (`proxy_admin`,
  `proxy_admin_viewer` or the service user) is refused with
  `409 PRIVILEGED_TARGET` (LT18).

## 13. Members

- **Inviting.** LiteLLM 1.109.1 has no invite or join-link endpoint (LD16).
  Add the person to the dashboard team first (a pending member by email is
  fine, Phase 4R.4); they then appear in the team configuration page's
  add-member list.
- **Orphaned members** are LiteLLM team members with no dashboard
  identity. `GET /api/litellm/orphans` lists them for an Admin or Auditor;
  ~~the Settings list arrives with unit A~~ (superseded 2026-11-17,
  management improvements D16a: no Settings list was built; Management →
  LiteLLM → *LiteLLM users*, filter **Members of one team**, shows a linked
  team's LiteLLM members, orphans included). Remove or link them in LiteLLM
  by hand.

## 14. Privacy under the Organisation cap

Until an `internal-admin` records the per-user approval (Access Control —
*Organisation cap*), the LiteLLM views show per-user counts only, for every
role. The keys list drops the user id and key name (LD27) and shows the
last four characters of the token hash instead; spend logs drop the person.

Accepted residual risks (LiteLLM spec — *Residual risks*):

- An Admin or Auditor can join a key's `tokenId` in the keys list with the
  key audit records and re-identify that key's spend. **Accepted by the
  user, 2026-11-17.**
- A Lead viewing a team member in *Users* sees that person's LiteLLM spend
  across all their teams (OSS cannot filter it by team).

## 15. Troubleshooting by error code

| Code or message | Meaning | Action |
|---|---|---|
| `LITELLM_UNAVAILABLE` (`503`) | LiteLLM did not answer, or answered outside the contract | Check that LiteLLM is up and the security group rule (§5); after an upgrade, check the contract snapshot |
| `OPERATION_DISABLED` (`403`) | The operation's toggle is off | Switch it on in Settings → LiteLLM (§10) if it should be allowed |
| `TOO_MANY_MEMBERS` (`422`) | An app team has more than 200 members, so its member sum is refused | Link the team to its LiteLLM team (§9) to use the LiteLLM team figure (§9a) |
| `OPERATION_UNAVAILABLE` (`403`) | The operation needs LiteLLM Enterprise and this deployment is OSS | None on OSS; for rotation, OSS uses generate then block (§12) |
| `PRIVILEGED_TARGET` (`409`) | The member or key belongs to a privileged LiteLLM user | Manage that user in LiteLLM with an operator key |
| "The team is not connected to LiteLLM" (`409`) | The dashboard team has no team link | Link it (§9) |
| "not connected" on the LiteLLM page | No connection is configured | An `internal-admin` sets the base URL and runs the connection test (§5) |

## 16. The end-to-end probe (local only)

`pnpm probe:litellm` checks the gateway against a real **local** LiteLLM
(LD28). It runs only with `LITELLM_PROBE=1`, refuses `APP_ENV=prod` and any
LiteLLM base URL other than `localhost:4000`, and is never part of
`pnpm test:e2e`, `pnpm check` or CI. The service key stays in
`apps/dashboard/.env.local`. The probe takes the e2e lock and uses the local
`bedrock-usage` table, so it does not run alongside `pnpm test:e2e`.

**Variables.**

| Variable | Mode | Meaning |
|---|---|---|
| `LITELLM_PROBE=1` | both | The opt-in; without it the probe refuses to start |
| `LITELLM_PROBE_MODE=fake` | fake | Set by `probe:litellm:fake`; any value other than `fake`, `real` or unset is refused |
| `LITELLM_PROBE_BASE_URL` | real | Must be exactly `http://localhost:4000` |
| `LITELLM_PROBE_TEAM` | real | The dashboard team id linked to `llmul-probe` (fake mode uses `team-probe`) |
| `LITELLM_PROBE_MODEL` | both | The model for the chat requests; default `claude-haiku` |

**Once: the fixture team (real mode).**

1. In the local LiteLLM, create the team `llmul-probe` with an operator
   key, allowing one cheap model (Claude Haiku class).
2. In the dashboard, create or pick a dashboard team and link it to
   `llmul-probe` in Management → LiteLLM → LiteLLM teams (§9; formerly
   Settings → LiteLLM → Team links). The stored
   connection must point at `http://localhost:4000`. The walk grants and
   removes the Lead's scope itself.

**Each run.**

```bash
# Real local LiteLLM
LITELLM_PROBE=1 LITELLM_PROBE_BASE_URL=http://localhost:4000 \
  LITELLM_PROBE_TEAM=<dashboard team id> pnpm probe:litellm

# Named fake mode (no LiteLLM needed)
LITELLM_PROBE=1 pnpm probe:litellm:fake
```

The probe signs in as Admin, the Lead and a Viewer with the forged e2e
session, adds one member, generates keys named `llmul-probe-<run id>`,
lowers the member's budget and limits, blocks, unblocks and rotates a key,
sends about 5 short chat requests **directly to LiteLLM** with the test key
(well under US$0.01 per run), checks that the spend appears, and resets the
member's spend. It switches `deleteKey` and `resetMemberSpend` on for the
run and restores them afterwards. Cleanup, also after a failure, deletes
its keys and removes its member; before each run it also clears what a
previous run left for its fixed identities.

**After a killed run** (cleanup did not run):

1. In Settings → LiteLLM, set `deleteKey` and `resetMemberSpend` back to
   their previous values (off by default).
2. Nothing for leftover `llmul-probe-*` keys: the next run deletes them on
   the fixture team before it starts.
3. The next run clears the leftover Lead scope and memberships itself.

**Left behind by design:** the audit records, LiteLLM's spend logs and, on
OSS, the LiteLLM user that adding the member created. Remove those users in
LiteLLM by hand (`POST /user/delete` with an operator key) when they pile
up.

**Fake mode** runs the same walk against a separate HTTP fake LiteLLM on
`127.0.0.1:3312`. The probe never falls back to it on its own. In the shared
local `bedrock-usage` table it leaves:

- the `team-probe` account, deactivated;
- the audit records of every write it made;
- the operation toggles' document, with its version moved on (values
  restored);
- the LiteLLM connection pointing at the fake, only if the previous URL no
  longer answered at teardown (the e2e dev-login spec saves its own).
