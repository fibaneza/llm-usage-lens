# Access Control Spec — Roles, Scopes and Membership

**Status:** adopted 2026-11-10 (unit R0). Implemented by Phase 4R sub-phases
RP and R1–R5 (Implementation Phases — *Phase 4R*). This spec replaces the
v1 rule "every signed-in member reads everything" in System Architecture
*Authentication & Access*; the Data Model and Design System point here.
Items marked **(user)** need the user's confirmation before production.

## Overview

Access is role-based and scope-limited, with identity from Microsoft Entra
ID or, until SSO is approved, from admin-managed password users (*Pre-SSO
mode*, amended 2026-11-14). Every decision is enforced on the server by one policy module, and every
change is audited. The model follows LiteLLM's user-management hierarchy,
role-based access, JWT team mapping and inheritance (docs.litellm.ai —
*User Management Hierarchy*, *Role-based Access Control*, *JWT-based Auth*,
*Access Management — Overview* and *Inheritance*) and defines what those
pages leave unstated: SSO-versus-UI precedence and empty groups.

**Principles:** least privilege and deny-by-default for data, separation of
duties, joiner-mover-leaver handling, periodic access review, a controlled
break-glass account. They align with ISO/IEC 27001:2022 Annex A 5.15–5.18
and 8.2 and NIST SP 800-53 AC-2, AC-5, AC-6 and AU-2 (alignment, not a
certification claim).

## Environment

`APP_ENV` (`dev` | `prod`) is a required, Zod-validated variable in `env.ts`
and the **only** switch for environment-dependent controls: every rule in
this spec stated "in `prod`" keys on `APP_ENV=prod` (Entra or the master
user required — *Pre-SSO mode*; TOTP for the master user, the per-user approval gate, `AUTH_ACCESS_MODE=enforce`
only, the legacy `Admin` alias removed). A deployed `dev` task runs `next
start` and therefore has `NODE_ENV=production`; `NODE_ENV` checks stay as an
additional floor for the dev-only login, never as the environment switch.
Unset or invalid `APP_ENV` fails env validation. `AUTH_SECRET` is required in
every environment (user, 2026-11-15): there is no per-process random fallback
for the list-cursor signing key, and env validation fails startup without it
(Rule 60.19).

## Hierarchy

Organization → Department → Team → User (LiteLLM's Organization → Team →
Internal User, without keys). A **team** is one AWS member account; a
**department** is LiteLLM's organization level. Permissions are evaluated
top-down and a child level can only **narrow** its parent (*Visibility and
inheritance*).

## Roles

Values are lower-kebab-case, case-sensitive, and live only in
`apps/dashboard/lib/auth/` (Rule 50.3). Entra app-role values carry the
`internal-` prefix.

| Role | Kind | LiteLLM analogue | Source | Reads | Writes |
|---|---|---|---|---|---|
| `internal-admin` | Global; a small named group (≥ 2 people) plus the master user | `proxy_admin` | Entra app role; in-app grant by an `internal-admin`; the master user | Everything | Everything: any team, any user, all configuration. **Only role that grants or revokes `internal-admin` and `internal-org-admin`** |
| `internal-org-admin` | Global | — (between `proxy_admin` and `org_admin`) | Entra app role, or in-app grant by an `internal-admin` | Every team and department | Admin scopes, members, moves and visibility in **any** team or department. **No configuration**, except the LiteLLM operation toggles (incl. reset) and team links (LiteLLM spec LD24; user, 2026-11-16, extending D14); no global-role grants |
| `internal-auditor` | Global | `proxy_admin_viewer` | **Entra app role only** | Everything, read-only, incl. the audit log and access review; never key values or secrets | Nothing — every write returns `403` |
| `internal-viewer` | Global; **the default** | `internal_user` | Entra app role, or the default | Own usage (*My usage*); their member team as visibility allows | Nothing |
| `internal-team-admin` | Scoped: **one or more** teams and/or departments, each a separate admin scope | `team_admin` (team scope), `org_admin` (department scope) | UI or SSO group mapping | Everything in its scopes | Members, team-scope admin grants (never on themselves) and visibility in its scopes; with a department scope also moves between that department's teams and the department cap |
| member (no role value) | A plain affiliation to one team | team role `user` | UI or SSO group mapping | The team, as visibility allows | Nothing |

**Configuration** (only `internal-admin`): group mappings, account CRUD
(Phase 4.9), the per-user approval, password users and the password
sign-in switch, the LiteLLM gateway configuration, connection and
edition, LiteLLM team creation, audit retention, identity links. The
LiteLLM operation toggles and team links are also writable by
`internal-org-admin` (LiteLLM spec LD24; user, 2026-11-16).

- **Union.** Effective permission = global role grants ∪ admin-scope grants,
  then narrowed by inheritance.
- **Effective roles (B1, 2026-11-15).** A caller's effective global roles are
  the session role claim ∪ the caller's in-app `ROLEGRANT#` items, read per
  request and never cached (Enforcement item 4). Every check that reads a
  global role (`requireAdmin`, `requireAdminOrAuditor`, `isAdmin`, the
  Settings capabilities) uses the effective set, so a password or Entra user
  holding an in-app `internal-admin` grant reaches the configuration routes.
- **Separation of duties.** `internal-auditor` comes only from Entra, so no
  in-app administrator can create or remove an auditor, and an auditor cannot
  write.
- **In-app global-role grants** (`internal-admin`, `internal-org-admin`):
  only an `internal-admin` makes or revokes one (others `403`); each needs a
  sign-in within the last 15 minutes (*Recent authentication*, D28) — else
  `403 REAUTH_REQUIRED` — and a written reason; each is audited (`role.grant` / `role.revoke`) and emits an id-only
  security event the DashboardServiceStack alarms on; the access review shows each grant's
  source (`entra` | `app` | `master`). The last in-app `internal-admin` cannot be
  revoked (`409`; atomic, *Enforcement* item 8). Removing the Entra role does not remove an in-app grant;
  the access review flags it.
- **Group mappings never target a global role** (rejected by the schema).
- **Migration.** The legacy value `Admin` is an alias of `internal-admin`
  until `AUTH_ACCESS_MODE=enforce` in `prod`, then removed. No `Lead`,
  `Viewer` or `Auditor` app roles are created.

## Identity, SSO mapping and defaults

**Stable identity.** Users are keyed by the token's `oid` with `tid`;
`email` and `preferred_username` (UPN) are display attributes. `auth.ts`
Zod-parses `oid`, `tid`, `roles` and `groups` into the JWT and
`session.user`. **Fail closed:** a missing `oid`, a foreign `tid`, or a
`roles`/`groups` claim that is present but not an array means no session.
The **identity record** `oid → { tid, email, upn, displayName, lastSignInAt,
lastSeenRoles[] }` (lower-cased `email`/`upn`) is upserted at each sign-in. **Amended R1 (2026-11-10):** the item also carries `authMethod` (`entra` | `master` | `local` | `password`, `password` amended 2026-11-14) and `version`; the master user's item carries the lockout fields; an identity upsert that fails fails the sign-in (fail closed). **Amended R2 (2026-11-12):** the item also carries the optional flags `ambiguousMembership` and `groupsOverage`, set and cleared by the sign-in resolution below.

**Entra configuration** (user action; steps in `docs/guides/auth-setup.md`):
"Assignment required?" = Yes; security groups assigned to the app roles
(placeholders `llm-usage-lens-admins`, `-org-admins`, `-auditors`, `-users`);
group-to-app-role assignment needs Entra ID P1/P2 and direct (not nested)
membership; the `groups` claim restricted to **"Groups assigned to the
application"** (object IDs; keeps tokens under the overage limit);
Conditional Access (MFA or compliant device).

**Default role.** A missing or empty `roles` claim, or only unknown values
(Entra's "Default Access" assignment emits no `roles`), means
**`internal-viewer`**. Unknown values never grant anything.

**Group mapping** (Settings; `internal-admin` only; audited):
`{ groupId, target: { type: "team" | "department", id }, scopedRole:
"internal-team-admin" | "member" }` — LiteLLM's `team_ids_jwt_field` plus
team-role assignment. `member` targets must be teams.

**Resolution at every sign-in** (deterministic):

1. Take the token's groups that have a mapping.
2. **No mapped groups, empty or absent claim** → no SSO items. A
   UI-sourced member affiliation is kept; otherwise **no team, and the user
   is `internal-viewer`** (*My usage* and "Ask your team lead for access").
3. **Admin-scope mappings** → every mapped target becomes an SSO-sourced
   admin scope (several allowed). The sync adds and removes SSO-sourced
   scopes to match the mapped groups exactly; UI-sourced scopes are never
   touched. Audited, actor `system`.
4. **Member mappings, one target** → SSO member affiliation, replacing a
   UI-sourced one (audited, actor `system`).
5. **Member mappings, several targets** → ambiguous: none applied (fail
   closed), only a UI-sourced affiliation kept, user flagged in Settings.
   Ambiguity never blocks admin scopes.
6. **Group overage** (`_claim_names`/`hasgroups` instead of `groups`) →
   treated as case 2 plus a flag; SSO-sourced admin scopes are suspended
   until a sign-in with a full claim. v1 makes no Microsoft Graph call.
   **Amended R2 (2026-11-12):** the flag is `groupsOverage` on the identity
   record. During overage no scope item is written or deleted — this
   includes binding a pending admin-scope invite, which stays pending until
   a sign-in with a full claim (pending member invites still bind; clarified
   2026-11-14); an
   SSO-sourced scope counts as suspended while the flag is true (one
   predicate in `packages/shared`), which the policy module enforces from
   4R.3. Ambiguity (case 5) sets `ambiguousMembership` the same way.

**One item per scope key (amended R2, 2026-11-12).** An SSO mapping onto an
existing UI-sourced admin scope overwrites it with `source: "sso"`; removing
the mapping later deletes the item. A sign-in's changes, flag updates and
their audit items are one `TransactWriteItems`; a sign-in whose
synchronisation fails gets no session (fail closed).

**Precedence: SSO-sourced > UI-sourced > none, per item** (the member
affiliation and each admin scope). A UI change to an SSO-sourced item
returns `409 MANAGED_BY_SSO`; change it in Entra. UI-sourced admin scopes
may sit alongside SSO-sourced ones and persist across sign-ins.

**Timeliness.** Entra changes apply at the next sign-in, bounded by the
session cap: 8 h; **4 h** for sessions holding `internal-admin` or
`internal-org-admin`; **1 h** for the master user. In-app changes are read
per request and apply on the next request.

## Sign-in methods

| Method | Where | Role |
|---|---|---|
| Entra ID (OIDC) | All environments; **required in `prod` once SSO is approved** — until then `prod` runs in *Pre-SSO mode* | From the token |
| **Master user** (username + password) | All environments; **required** in Pre-SSO `prod` | Always `internal-admin` |
| **Password users** (email + password, amended 2026-11-14) | All environments, while password sign-in is on (*Password users*) | In-app role grants, member team and admin scopes, set in Settings |
| Dev login (no password) | **Outside production and only while Entra is not configured** | With no identity: chosen at sign-in, default `internal-admin`. With an identity: that stored user's `lastSeenRoles` (amended L3c2, user, 2026-11-16) |

**Master user** (break-glass and first-time setup; amends System
Architecture *Sign-in providers*):
- **Credential:** `AUTH_MASTER_USERNAME`; only an **Argon2id hash** of the
  password, as an SSM SecureString injected via the task definition's
  `secrets` — never in the repo, image or DynamoDB. Both go through
  `env.ts`; absent → the method is not offered.
- **Second factor:** TOTP required in `prod` (secret also an SSM
  SecureString). Constant-time verification, generic errors.
- **Lockout (R1, 2026-11-10):** stored on the master identity item
  (`failedAttempts`, `lockedUntil`, atomic `ADD`) so every task shares it;
  the counter restarts after a lock expires; success resets it.
- **Lockout:** 5 failures → 15 minutes. The one recorded exception to "no
  rate limiting".
- **Session:** 1 hour. Every sign-in, failure and lockout is audited and
  alarms.
- **Identity:** fixed namespaced `oid` `master:` (never collides with
  Entra); cannot be demoted or deleted in the app; listed in the access
  review.
- **Custody:** sealed with two-person control, rotated after every use and
  at least yearly, test sign-in quarterly (`auth-setup.md` — *Master user*).
  In Pre-SSO mode it stays break-glass: it creates the first password
  `internal-admin`, is rotated and sealed again, and is not the daily admin
  login.

**Dev login.** Outside production and only while Entra is not configured, a
no-password login offers a role choice (R1) and, from L3c (user, 2026-11-16), an
optional identity: an email or a dashboard `oid`. **Amended L3c2 (user,
2026-11-16; a dev-debugging aid, not a production feature):** with the identity
empty, the session is the Local Developer (`local:dev@localhost`) with the role
chosen on the form (default `internal-admin`), as before. With an identity, it
must match a stored identity (by `oid`, or by lower-cased email), and the session
is that user's: its `oid`, email and name, and as role claim the stored
`lastSeenRoles` filtered to valid global roles (the claim that user had at their
last real sign-in); an absent or empty claim gets the baseline a password user
with no roles gets (`internal-viewer`, via `resolveGlobalRoles`). The form's role is
ignored entirely, and the sign-in page disables the Role select while an identity
is typed. In-app grants, team-lead scopes and affiliations then apply per request
as for that user. An identity that is not stored (unknown email or unknown `oid`)
is refused with the one generic failure; the synthetic `dev-` identity for an
unknown email is removed. A `master:` `oid` is refused (case-insensitive) before
any store read, and a dev sign-in as a stored identity never overwrites its stored
provenance (`authMethod`, `tid`, `lastSeenRoles`); only `lastSignInAt` moves.
**It is rejected by env
validation when Entra is configured** (amending *Sign-in providers*, which
allowed both outside production). Production fail-closed checks are
unchanged; no production bypass exists (Rule 70.11).

### Pre-SSO mode

Amended 2026-11-14 (user, D19): setting up SSO needs company approval and
governance, so `prod` may run **without Entra** until it is approved. Env
validation accepts `APP_ENV=prod` with the Entra variables unset only when
the master user is configured (with TOTP); everyone else signs in as a
password user. Turning SSO on later is configuration only: the two Entra
CDK inputs and the client-secret parameter, then a redeploy (Platform —
*Inputs*). From then on the rules in *Identity, SSO mapping and defaults*
apply and password users move to Entra through *SSO reference and binding*.

### Password users

Amended 2026-11-14 (user, D9 superseded by D20; storage D21). They replace
v1's dev-only stored local users.

- **Accounts.** Only an `internal-admin` creates, disables, re-enables,
  resets or deletes a password user (`/api/password-users`, audited). The
  admin enters the work email (lower-cased; it is also the person's
  canonical usage identity, *Canonical usage identity*), a display name and,
  optionally, the SSO reference below. The email must not be another
  identity's email, usage identity or alias (`409`). Global roles are in-app
  role grants (D15); the member team and admin scopes are ordinary UI-sourced
  items under the user's identity, managed as for Entra users (*Permission
  matrix*). The last enabled password `internal-admin` is protected (`409`)
  while Entra is not configured (atomic, *Enforcement* item 8).
  Credential-affecting writes need recent authentication (create, reset,
  TOTP reset, delete; *Recent authentication*).
- **Identity.** Each password user gets an identity `oid` `local:<uuid>`
  (random, namespaced; never collides with Entra or `master:`), `tid`
  `local`, and `authMethod: password`.
- **Setup (D22).** Creating or resetting a user returns a **one-time setup
  link** in exactly one response (`no-store`; never stored or shown again):
  `https://<host>/account/setup#<token>`, a 32-byte random token in the URL
  fragment so it never reaches access logs. Only its SHA-256 hash and expiry
  (72 h) are stored; it is single-use, and a reset or delete invalidates it.
  The setup page posts the token to the Auth.js **`password-setup`**
  credentials provider (no new unauthenticated Route Handler), which sets
  the password, enrols TOTP when required and starts a session. An unknown,
  used or expired token gives one generic error.
- **Passwords.** Argon2id hash only (the master user's parameters), never
  returned by any API or logged. 12–128 characters, no composition rules,
  rejected when in a bundled common-password list; **no periodic rotation**
  (NIST SP 800-63B). A signed-in password user may change their own
  password with the current one (and TOTP when enrolled) on the **Account
  page** `/dashboard/account` (D30): current password, new password,
  confirmation and a TOTP code when enrolled, posted to `POST
  /api/account/password`; other sign-in methods see their method and no
  form. A forgotten password is an admin reset (no self-service reset:
  there is no email service).
- **Credential version (D29).** The `LOCALUSER` item carries an integer
  `credentialVersion` (absent = `0`), copied into the JWT at sign-in
  (`password` and `password-setup`). For every request of a password session
  the session check reads the item (uncached, Rule 60.10) and ends the
  session (`401`; pages redirect to sign-in) when the item is missing, not
  `enabled`, or its `credentialVersion` is higher than the token's. An own
  password change, an admin reset, an admin TOTP reset, a disable and a
  delete increment it in the same transaction as the change, so every other
  session of that user ends on its next request (a TOTP reset usually
  follows a lost or compromised device). The session that changed its own
  password keeps going without the client's help: the change stores a
  marker `selfChangeSignedInAt` equal to that session's `signedInAt`, and the
  session check adopts the stored version only when the marker matches the
  token's own `signedInAt`, compared to the **millisecond** (user,
  2026-11-15), so a session that signed in within the same second as the
  changer is still ended. No `update` payload is ever read. Any other
  increment clears the marker. Residual risk: *Residual risks* — the
  stolen-copy limit.
- **TOTP (D23).** **Required** when the user holds any global role other
  than `internal-viewer` or any admin scope; optional otherwise. A grant
  that makes it required takes effect at the next sign-in, which requires
  enrolment before a session is issued. A user who needs TOTP but never
  enrolled gets no session from the password sign-in; the enrolment path is an
  admin-issued **reset** link, whose setup flow enrols TOTP when required
  (D31; no separate enrolment route). The secret is envelope-encrypted
  with a CMK data key before it is stored and never returned; the last used
  time step is stored and a reused code is refused.
- **Sign-in.** Email + password (+ TOTP) through the Auth.js `password`
  credentials provider. Per-user lockout as for the master user (5 failures
  → 15 minutes, atomic `ADD`, shared by every task); an unknown email runs
  the same Argon2id work against a dummy hash and returns the same generic
  error. Session caps as for Entra users (8 h; 4 h with `internal-admin` or
  `internal-org-admin`). Disabled, deleted, locked and `sso-bound` users get
  the same generic error.
- **Alongside Entra (D24).** A `GOVERNANCE`/`PASSWORD_SIGNIN` switch
  (`internal-admin`, audited, versioned) turns password sign-in off for
  everyone. It is on by default, so that, once Entra is configured, users
  not yet bound keep working while they move; the access review flags every
  enabled password user, and turning the switch off once everyone is bound
  is a runbook step. It cannot be turned off while Entra is not configured.

### SSO reference and binding

Each password user's record carries the person's **future Entra identity**,
so enabling SSO converts accounts in place (user, 2026-11-14).

- **Stored:** `sso.expectedUpn` (defaults to the email), optional
  `sso.expectedOid` (the person's Entra object id, copied from Entra by the
  admin — the stronger match), and, once bound, `sso.tid`, `sso.oid` and
  `sso.boundAt`. Each expected value is reserved by an `SsoReservation` item
  and each binding by an `SsoRef` item (*Data model additions*), written in
  the same transaction with `attribute_not_exists(PK)`, so one Entra
  identity can never attach to two people.
- **Bind (D25)** at an Entra sign-in when `tid` is the configured tenant and
  either the token's `oid` equals a reserved `expectedOid`, or, with no
  `expectedOid` set, `preferred_username` equals a reserved `expectedUpn`
  case-insensitively. The `email` claim and guest UPNs (`#EXT#`) never
  match (T2). **One `TransactWriteItems`** moves every item that references
  the `local:` identity (member affiliation, admin scopes, role grants,
  identity link, usage-key claims) to the Entra `oid`, writes the `SsoRef`,
  deletes the reservations, sets the password user's `status: sso-bound`
  and writes one `identity.bind.sso` audit record (actor `system`, with both
  ids). A person whose items would not fit one transaction, or whose Entra
  `oid` already owns items, is **not** merged: the Entra sign-in proceeds as
  a separate identity and Settings flags the conflict for an
  `internal-admin` to resolve.
- **After binding** the password is refused for that user and Entra is
  their only sign-in; their dashboards, budget and spend continue under the
  same email. Roles then follow *Identity, SSO mapping and defaults*: the
  token's app roles plus the migrated in-app grants, with SSO precedence for
  team items.

## Visibility and inheritance

Per team, plus per department. Editable by `internal-admin`,
`internal-org-admin`, and an `internal-team-admin` whose scope covers it.
Least-privilege defaults; a missing item means the defaults.

| Setting | Values | Default |
|---|---|---|
| Team level — members see the team's totals and breakdowns (Team Detail; its rows on Teams, Services, Ranking) | `visible` / `hidden` | `visible` |
| User level — per-user rows for this team | `all` / `own` / `none` | `own` |
| Department level — the department's totals (Departments card, Department Detail, department rows in Overview and Ranking) for members of its teams | `visible` / `hidden` | `hidden` (it reveals sibling teams' aggregate spend) |
| Department cap — `maxUserLevel` for its teams | `all` / `own` / `none` | `own` |

**Inheritance — child narrows parent** (LiteLLM: key and team must both
allow): `effective = min(organisation cap, department cap, team setting)`,
with `hidden < visible` and `none < own < all`.
- **Organisation cap** = the per-user approval gate (`APP_ENV=prod`):
  until an `internal-admin` records the works-council / data-protection
  approval (who, when, reference; audited), **every** caller —
  `internal-admin`, `internal-org-admin`, `internal-auditor` and
  admin-scope holders alike — sees per-user **counts** only, and user level
  is capped at `own`. Everyone always sees their own usage. The access
  review and the audit log are not per-user cost and stay available.
- A team setting above its department cap is stored, **applied as the cap**,
  and shown as "limited by department".
- Callers below `internal-org-admin` see organisation-wide views (Overview
  KPIs, rankings) only over in-scope data, labelled "your teams".
- **Privacy:** per-user cost is personal data; the legal basis and retention
  are a **(user)** decision (DPO/HR) — proposed wording under *Decisions*.

**Evaluation order** — the single `resolveScope` pipeline; any failure
denies (`401`/`403`/`404` per *Enforcement*): (1) token valid (issuer,
`tid`, `oid`, session cap) → (2) global role → (3) member affiliation and
admin scopes (precedence above) → (4) inherited caps → (5)
`can(action, resource)`.

## Membership, admin scopes and lifecycle

Access comes from **explicit affiliation and scopes**, never from usage data
(`byUser`): usage-derived access would exclude people who never call Bedrock
and admit anyone who once used an account.

- **Member: at most one team.** Its department is implied per day by the
  rollups (*Historical Snapshots for Department/Team Names*). One item per
  user enforces "single team".
- **Admin scopes: one or more** teams and/or departments, each its own item.
  An admin scope implies read access to its team or department; the holder's
  own member team is independent. Oversight of several teams is several team
  scopes or one department scope (which covers teams added later).
- **Department scope is per day** (decision W3): a team that moved
  department counts for a department-scope holder only on the days its
  rollups name that department.
- `internal-admin`, `internal-org-admin` and `internal-auditor` need neither.

**Joiner.** An admin enters a work email or UPN → a **pending** member
affiliation (or pending admin scope). At first sign-in it is **bound to the
`oid`** when `tid` is the configured tenant and the lower-cased
`preferred_username` (UPN) equals the pending key (audited, actor `system`).
**Amended R2 (2026-11-12):** the `email` claim is display-only and is never a
bind key (it is not a verified, unique attribute in Entra); a guest UPN
(`#EXT#`) is never bound automatically; there is no fallback to `email`. Two
pending affiliations for different teams bind neither (fail closed). After binding,
`oid` is the key, so a UPN change or reuse cannot redirect it. An SSO member
mapping at the same sign-in wins and the invite is discarded (audited). No
Graph permission or client secret is needed. Pending items grant nothing.

**Mover.** Moving a member to another team needs authority over **both**
teams; it is **one atomic transaction** (`TransactWriteItems` with the
`version` condition) with one `affiliation.move` audit record; it **removes
the team-scope admin on the source team** in the same transaction (other
scopes are unaffected); it is refused for an SSO-sourced affiliation (`409
MANAGED_BY_SSO`). Adding a user who already has a member team returns `409
ALREADY_AFFILIATED` — use move.

**Leaver.** A user disabled in Entra cannot sign in, so their items grant
nothing. **Stale** items are pending items not bound after 30 days, and
affiliations, admin scopes and in-app grants whose user has not signed in
for 90 days (decision D2); the access review flags them. Settings lists the
pending and stale items in 4R.4, behind a scoped read route filtered by the
management-read rule and paginated with the opaque cursor (D34, reversed by
the user 2026-11-15; Design System — *Settings Page*).

**Permission matrix:**

| Action | `internal-admin` | `internal-org-admin` | `internal-team-admin` (department scope) | `internal-team-admin` (team scope) | Others |
|---|---|---|---|---|---|
| Add an unaffiliated user (or pending email/UPN) as member | ✓ | ✓ any team | ✓ teams in scope | ✓ teams in scope | ✗ |
| Grant or remove a team-scope `internal-team-admin` | ✓ | ✓ any team | ✓ teams in scope | ✓ teams in scope; never their own scope (grant or remove) | ✗ |
| Grant or remove a department-scope `internal-team-admin` | ✓ | ✓ | ✗ | ✗ | ✗ |
| Remove a member | ✓ | ✓ any team | ✓ teams in scope | ✓ teams in scope | ✗ |
| Move a member to another team | ✓ | ✓ | ✓ both teams in scope | ✗ (remove; the destination admin adds) | ✗ |
| Edit visibility | ✓ | ✓ | ✓ dept, its cap and its teams | ✓ teams in scope | ✗ |
| Grant or revoke `internal-org-admin` / `internal-admin` | ✓ **only** | ✗ | ✗ | ✗ | ✗ |
| LiteLLM operation toggles (incl. reset) and team links (LiteLLM LD24; user, 2026-11-16, extending D14) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Configuration (everything else in *Configuration* above) | ✓ | ✗ | ✗ | ✗ | ✗ |

**Identity links** (shared contract): `usageIdentities[]`, `aliases[]`,
`litellmUserId`, per `oid`, `internal-admin` only. An alias or usage
identity belongs to one person (duplicate → `409`). A link holds at most
that person's **own canonical email** as a person-kind key
(*Canonical usage identity*), and only in `usageIdentities[]`. Any other
person-kind key — a syntactically valid email, or an ARN whose session name is
one — returns `409`, whether or not another identity owns it, and so does any
person-kind alias, the own email included; non-person keys are accepted
(agent decision, 2026-11-16: a stored unowned email would show its
holder that person's usage once they sign in, T16; confirmed D27). Links show a
person their own usage and **never grant access**.

**Usage-identity mapping rules (D27, amended 2026-11-14, user).** Some
Bedrock callers sign in with a session name that is not an email — for
example the identity ARN
`arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_<set>_<id>/jane-sso`
is not an email, so `byUser` keeps it as the raw non-person key (the whole
value, *Canonical usage identity*), while the person's
dashboard and LiteLLM identity is `jane@company.com`. An `internal-admin`
defines **mapping rules** in Settings: a pattern with one `{name}`
placeholder over the **session name** — the substring after the last `/`
or `:` of the key, here `jane-sso` (amended 2026-11-15, D35) — (e.g.
`{name}-sso`) and a template for the
email (e.g. `{name}@company.com`). Rules are stored in one
`GOVERNANCE`/`IDENTITY_MAP_RULES` item (versioned, audited; no new key
prefix). The Identity links section then **suggests** a link for each
non-person usage key that a rule maps to an existing identity's email; the
admin confirms each suggestion (or confirms all for one rule), and the
confirmed key is stored as an exact `alias` with its `UsageKeyClaim` —
matching stays exact and never fuzzy, and uniqueness still applies
(`409`). The same email resolves the LiteLLM user (`litellmUserId`,
LiteLLM spec — *Identity mapping and members*). Rules never grant access
and never map to a person automatically.

**Canonical usage identity.** One function in `packages/shared` (dashboard
on read now; collector in Phase 6): take the substring after the **last** `/`
or `:` of CloudTrail `userIdentity.arn`/`principalId`, trim, lower-case,
accept only a syntactically valid email; otherwise keep the raw key — the
whole original value, not the substring — with `kind: "non-person"`
(D35); a confirmed D27 alias is that raw key. Example: `…:assumed-role/AWSReservedSSO_X_Y/Jane.Doe@Company.com`
and `AROAEXAMPLE:jane.doe@company.com` → `jane.doe@company.com`. A usage key
belongs to a person when it equals their canonical email or is in their
`usageIdentities[]`/`aliases[]`; never fuzzy.

**Access review** (quarterly; `internal-admin`, `internal-auditor`): CSV of
every identity with global roles and sources, member team and admin scopes
with sources, `lastSignInAt`, aliases, the LiteLLM link and flags
(ambiguous, overage, stale, Entra role removed while an in-app grant
remains). The export is audited.

## Enforcement

1. **One policy module** in `lib/auth/`: pure `resolveScope(...)` and
   `can(scope, action, resource)`, called by every Route Handler and Server
   Component after the session check and before returning data. Hiding in
   the UI is never the control (Rule 10).
2. **Status codes.** Out-of-scope and nonexistent details return `404` with
   an **identical body**. An unauthorised write returns `403` before input
   parsing. Lists contain only in-scope rows.
3. **Aggregates after filtering.** Every total, "% of Total", count, top-N,
   most-used model, trend and comparison uses only in-scope rollups and
   attribution; nothing out of scope is inferable from the difference of two
   visible numbers.
4. **Caching cannot leak.** `unstable_cache` stays scope-independent (raw
   rollups per UTC day); filtering runs after the read, outside the cache.
   **Authorization data is never cached** (roles, grants, affiliations,
   scopes, mappings, visibility, links, the approval), so changes apply on
   the next request on every task with no `revalidateTag`; no cross-task
   invalidation is relied on. Every Route Handler response under `/api/*`
   sets `Cache-Control: private, no-store` (delivered 2026-11-11 with the
   security-review fixes, ahead of R3). Auth.js's own handler sets its own
   headers. The proxy answers a logged-out `/api/*` request with the same
   no-store JSON `401` `UNAUTHORIZED` as the route handlers (one shared
   helper; amended 2026-11-15) and redirects only pages to sign-in; its
   matcher skips exactly `/api/auth`, `/api/auth/*` and `/api/health`. That
   redirect and the framework's `404`/`405` for an unknown path or method
   carry no data.
5. **Exports and search are scoped:** CSV, command menu, search, and links.
6. **Writes.** Zod-validated; a body `teamId`/`departmentId` must equal the
   path (`400`). Optimistic concurrency via a `version` attribute and a
   conditional write (`409`). Same-origin check: every write request
   (`POST`/`PUT`/`PATCH`/`DELETE`) must carry an `Origin` header whose host
   equals the request `Host`; a missing or different `Origin` returns `403`
   `FORBIDDEN`, after the session (`401`) and permission (`403`) checks and
   before input parsing. A write body must be `Content-Type:
   application/json`, else `400`. Both were delivered 2026-11-11 with the
   security-review fixes, ahead of R4 (user direction); Auth.js's own
   handler keeps its CSRF token instead. `write-routes.integration.test.ts` enumerates every write route
   with its required permission. A route that needs recent authentication
   checks it next, after the same-origin check and before input parsing
   (*Recent authentication*). **No rate limiting** of dashboard routes
   (internal, VPN-only; request/token limits are LiteLLM's), except the
   master-user lockout.
7. **Observability.** Policy denials (403/404) are a span event with no
   personal data now and a counter when OTel metrics land (the app has no
   metric emitter yet; amended 2026-11-15); tokens, claims and session contents are never logged. Write
   denials additionally produce a `denied` audit record (*Audit log*, D17).
8. **Last-admin invariants are atomic (D32).** Revoking an in-app
   `internal-admin` grant, and disabling or deleting a password user who
   holds `internal-admin` while Entra is not configured, is one
   `TransactWriteItems`: the change, its audit record, and a
   `ConditionCheck` that **another** enabled admin still exists. The other
   admin is picked from a read of the candidates and the check names its
   items: for a revoke, another identity's `ROLEGRANT#internal-admin` item
   exists; for a disable or delete, another password user's `LOCALUSER`
   item is `enabled` and that user's `ROLEGRANT#internal-admin` item exists
   (the master user is not counted). The same holds for a revoke: only an
   **enabled** holder counts, so a disabled password user's grant never
   satisfies the check (amended 2026-11-15). Two concurrent removals of the last two
   admins each check an item the other changes, so the transactions conflict
   or the second one's condition fails: at least one returns `409`
   `CONFLICT` and writes no `success` record. No candidate → `409` without a
   write. A read-then-write check alone is not enough (TOCTOU, T33).

## Recent authentication

Amended 2026-11-15 (D28; open questions resolved by D33). A write marked
**re-auth** in *API routes (additions)* needs a sign-in within the last
**15 minutes** (`REAUTH_MAX_AGE_SECONDS = 900`). The list is the global-role
writes and the credential- and sign-in-affecting admin writes (D33):

| Route | Settings section (step-up return) |
|---|---|
| `POST /api/role-grants`, `DELETE /api/role-grants/[oid]/[role]` | `#role-grants` |
| `POST /api/password-users`, `DELETE /api/password-users/[email]`, `POST /api/password-users/[email]/reset`, `POST /api/password-users/[email]/totp-reset`, `PUT /api/governance/password-sign-in` | `#password-users` |

Not re-auth: group mappings (they never grant a global role), memberships,
admin scopes, visibility, identity links and mapping rules, password-user
`PATCH` (enable or disable), the per-user
approval, and the own password change (it already requires the current
password).

- **What is measured.** `authTime` (Unix seconds) is when the person last
  proved a credential: for Entra, the verified ID token's `auth_time` claim
  (an optional claim the app registration must emit; auth guide); for the
  master user, password users, `password-setup` and the dev login, the time
  the `jwt` callback runs for that sign-in (the `authorize()` check has just
  passed). It is not `signedInAt`, `iat` or the callback time of an Entra
  sign-in: Entra can satisfy a sign-in from an existing SSO session, and only
  `auth_time` tells the two apart.
- **Where it lives.** A JWT field set **only** in the `jwt` callback branch
  that has `account` (a sign-in), never from an `update` payload, a request
  parameter or a cookie, and copied read-only to `session.user.authTime`.
  An Entra token without a valid integer `auth_time` gets no `authTime`: the
  session is still issued, but every re-auth write needs a step-up. The
  session token schema keeps it optional, so sessions issued before this
  change stay valid.
- **The check.** A pure `hasRecentAuth(authTime, nowSeconds)` in
  `lib/auth/recent-auth.ts` is true only for a finite number with
  `now − 900 ≤ authTime ≤ now + 60` (the session clock-skew allowance).
  `withRoute(..., { requireAdmin: true, requireRecentAuth: true })` applies
  it after the session (`401`), the role (`403 FORBIDDEN`) and the
  same-origin (`403 FORBIDDEN`) checks and before input parsing or any
  DynamoDB call, returning `403` with `{ error: { code: "REAUTH_REQUIRED",
  message: "Re-authentication required" } }` — `403`, not `401`, because
  the session stays valid and the client must not treat it as signed out.
  The body is the same for every target, so it reveals nothing about one.
  Reads are never gated.
- **Audit.** `REAUTH_REQUIRED` is not an authorization refusal (the caller
  holds the permission), so it writes **no** `denied` record (D17; kept by
  D33: a challenge is not a refusal, and recording each would only add
  alarm noise); it adds a `reauth.required` span event (no personal data) now and an
  id-free `ReauthRequired` counter when OTel metrics land (the app has no
  metric emitter yet; amended 2026-11-15). The step-up is an ordinary
  sign-in and is audited as one (`auth.signin.success`, D18; failures and
  lockouts as today).
- **Step-up.** A step-up is a full sign-in through the existing providers
  (no provider bypass, no new Route Handler): it replaces the session,
  re-runs sign-in synchronisation, and restarts the session cap (accepted,
  D33: a new authentication issues a new session with its own cap). Server
  Actions in `apps/dashboard/app/dashboard/settings/step-up-actions.ts`
  (`stepUpWithEntra`, the password step-up and the dev-login step-up), each
  refusing a caller with no session or of another `authMethod` (a
  session-and-method guard; amended 2026-11-15):
  - **Entra:** `signIn("microsoft-entra-id", { redirectTo }, { prompt:
    "login", max_age: "900" })` — Auth.js v5 passes the third argument as
    authorization parameters. Only the step-up sends them; the ordinary
    sign-in keeps SSO. The request parameters are not trusted (they pass
    through a query string): the server check reads only `auth_time`.
  - **Password users and the master user:** the person re-enters the
    password, plus TOTP when enrolled (always for these roles, D23, and for
    the master user in `prod`). The action takes the identifier from the
    session (the session email; `AUTH_MASTER_USERNAME`), never from the
    form, so a step-up cannot switch identity, and calls the `password` or
    master provider — lockout, generic errors, timing-equal paths and TOTP
    reuse refusal apply unchanged. A failed step-up returns one generic
    error to the form and leaves the current session as it was.
  - **Dev login:** choosing the dev login again (its own path; the dialog
    never shows the password form to a dev-login session).
  - `redirectTo` is the Settings section that started the step-up, chosen
    from a fixed allowlist of exactly two values:
    `/dashboard/settings#role-grants` and
    `/dashboard/settings#password-users` (the table above; D33). The
    action takes a section key (`role-grants` | `password-users`), never a
    URL; any other value is refused. There is no return-URL parameter.
- **UI.** On `REAUTH_REQUIRED` the dialog that sent the write (Role grants,
  or a Password users action or the password sign-in switch) shows "Confirm
  it's you" with the control for `session.user.authMethod` (a button for Entra;
  password and TOTP fields otherwise). It never replays the write: after the
  step-up the admin submits again. The unsent draft (its non-secret fields,
  e.g. target, role, reason; never a password, code or setup link) may be kept in `sessionStorage` and restored once, never in the
  URL. A second `REAUTH_REQUIRED` straight after a step-up shows an error
  ("Your sign-in could not be confirmed as recent") instead of starting
  another step-up. The UI may read `session.user.authTime` to ask first; the
  server check is the control.

## Audit log

- **Schema:** actor `oid` (or `system`), `action`, `target` (omitted only on `denied`), `teamId?`,
  sanitised `before`/`after` (never secrets or key values), `result`
  (`success` | `failed` | `denied`; `denied` amended 2026-11-14),
  `timestamp` (UTC), `requestId`, and `category` (`security` | `change`,
  amended R2 2026-11-12): `security` for `auth.master.*`,
  `auth.signin.error`, `role.grant`, `role.revoke` and every `denied` record
  — the field the Platform security alarm filters on; `change` otherwise.
  `before`/`after` keep only allowlisted keys with scalar, string-array or
  `{type,id}` values.
- **Semantics:** a successful write → exactly one `success`; a write that
  passed authorization but failed downstream → exactly one `failed`; a write
  refused by **authorization** → exactly one `denied` (below); any other
  rejection (`400`, `401`, `403 OPERATION_DISABLED`/`OPERATION_UNAVAILABLE`/`REAUTH_REQUIRED`,
  `404` for a target that does not exist, `409` version or
  `MANAGED_BY_SSO` conflicts) → none. `POST /api/account/password` from a
  session whose `authMethod` is not `password` is an authorization refusal:
  `403 FORBIDDEN` before parsing, with one `denied` record (action
  `localuser.update`, `route: { method: "POST", pattern:
  "/api/account/password" }`; D17; amended 2026-11-15, D36). Audit-log views and access-review
  exports are themselves audited.
- **Denied attempts (D17, (user) 2026-11-14):** a write refused with
  `403 FORBIDDEN`, with the `404` returned for an existing but out-of-scope
  target, or with `409 PRIVILEGED_TARGET` writes one `denied` record: actor,
  `action` (the operation; a route refused before parsing records the
  operation it serves, plus `route: { method, pattern }` with the route's
  fixed pattern, never the raw path), the error code (`code`:
  `FORBIDDEN` | `NOT_FOUND` | `PRIVILEGED_TARGET`; amended 2026-11-13, R2a), and `target`/`teamId` only when they are already
  validated ids (otherwise omitted — raw path or body values are never
  recorded). `denied` records are **security events**: they feed the
  Platform security alarm. The record is a separate `PutItem` before the
  response; the response body, status and `404` parity are unchanged, and a
  failed record write increments the delivery metric instead of changing the
  response. To bound noise, each task keeps at most one `denied` record per
  actor and action per minute; repeats in that minute only increment a
  `DeniedSuppressed` metric. Read refusals stay metric-only (*Enforcement*,
  item 7).
- **Sign-ins and sign-outs (D18, (user) 2026-11-14):** every successful
  sign-in writes `auth.signin.success` and every explicit sign-out
  `auth.signout`, with the method (`entra`, `master`, `password`, `local`) and no
  claims. They are not security events. Master-user sign-ins also keep their
  `auth.master.*` security records; session expiry is not an action and is
  not recorded.
- **Covered:** role grants, group mappings, affiliations (add, remove, move,
  bind), admin scopes, visibility, identity links, password users (create, setup,
  reset, TOTP reset, disable, delete, own password change, bind), the
  password sign-in switch, accounts, the approval, sign-ins and sign-outs, denied write attempts, and the
  LiteLLM actions (LiteLLM spec — *Audit*).
- **Atomicity:** a successful write's audit item is written **in the same
  `TransactWriteItems`** as the change, so neither exists without the
  other; a `failed` record is a separate `PutItem` after the downstream
  failure. The CloudWatch line is best-effort after commit; a delivery
  failure increments a metric that alarms.
- **Storage:** DynamoDB, append-only (`PutItem` only), plus one JSON line per
  record in the KMS-encrypted CloudWatch Logs group
  `/llm-usage-lens/<env>/audit` (a SIEM may subscribe). An id-only
  OpenTelemetry event accompanies each record.
- **Retention (D3, confirmed 2026-11-14):** 400 days in both stores (CloudWatch
  `retentionInDays: 400`; DynamoDB TTL `expiresAt`).

## Rollout

`AUTH_ACCESS_MODE` (`open` | `enforce`) in `env.ts`; unset or invalid →
`enforce`; `open` is rejected when `APP_ENV=prod` and exists only to stage
the migration in `dev`. In `open` mode reads behave as v1, every write
except `internal-admin` account CRUD returns `403`, and every LiteLLM route
is disabled. Runbook: `docs/guides/auth-setup.md` — *Role-based access
rollout*.

## Data model additions

Same table `bedrock-usage`; no new GSI (new GSI1 prefixes never collide with
`DATE#`/`DEPT#`). Zod schemas in `packages/shared`, types via `z.infer`.

| Entity | PK | SK | GSI1pk | GSI1sk |
|---|---|---|---|---|
| Identity | `IDENT#{oid}` | `META` | `IDENTS` | `IDENT#{oid}` |
| IdentityLink | `IDENT#{oid}` | `LINK` | — | — |
| UsageKeyClaim | `USAGEKEY#{key}` | `OWNER` | — | — |
| Member affiliation (≤ 1) | `IDENT#{oid}` | `AFFILIATION` | `MEMBERS#TEAM#{id}` | `IDENT#{oid}` |
| Admin scope (≥ 0) | `IDENT#{oid}` | `ADMINSCOPE#{TEAM\|DEPT}#{id}` | `ADMINS#{TEAM\|DEPT}#{id}` | `IDENT#{oid}` |
| Role grant (in-app) | `IDENT#{oid}` | `ROLEGRANT#{role}` | `ROLEGRANTS` | `IDENT#{oid}#{role}` |
| Pending item | `PENDING#{emailOrUpn}` | `AFFILIATION` or `ADMINSCOPE#…` | `MEMBERS#…` / `ADMINS#…` | `PENDING#{emailOrUpn}` |
| GroupMapping | `GROUPMAP#{groupId}` | `META` | `GROUPMAPS` | `GROUPMAP#{groupId}` |
| Visibility | `VIS#{TEAM\|DEPT}#{id}` | `META` | — | — |
| PasswordUser (was LocalUser; amended 2026-11-14) | `LOCALUSER#{email}` | `META` | `LOCALUSERS` | `LOCALUSER#{email}` |
| SsoReservation | `SSOEXPECT#{OID\|UPN}#{value}` | `OWNER` | — | — |
| SsoRef | `SSOREF#{tid}#{oid}` | `OWNER` | — | — |
| PasswordSignIn | `GOVERNANCE` | `PASSWORD_SIGNIN` | — | — |
| SetupLink (amended 2026-11-14, R2b-2) | `SETUPLINK#{sha256(token)}` | `OWNER` | — | — |
| PerUserApproval | `GOVERNANCE` | `PER_USER` | — | — |
| AuditRecord | `AUDIT#{YYYY-MM-DD}` | `{timestamp}#{requestId}#{nn}` | — | — |

`{nn}` is the record's two-digit index within its **request** (amended R2,
2026-11-12; "request" rather than "transaction" amended 2026-11-13, R2a):
one request can write several records (sign-in synchronisation, or two
domain calls), which `{timestamp}#{requestId}` alone would collide on. Every
audit `PutItem` carries `attribute_not_exists(SK)`, so a collision fails
loudly instead of overwriting (append-only, T18, T19).
The role literals the shared schemas need (grantable and local-user roles)
live in `packages/shared` beside the group-mapping schema; the role *check*
stays in `lib/auth/` (Rule 50.3).

Every mutable item carries `version`; the `PasswordUser` item also carries
`credentialVersion` (D29; incremented by an own password change, a reset, a
TOTP reset, a disable and a delete) and, after an own change,
`selfChangeSignedInAt`. Access patterns: caller's items
`Query PK=IDENT#{oid}`; a team's members/admins `Query GSI1` (paginated,
Rule 20.6); bind `Query PK=PENDING#{upn}`; visibility
`BatchGetItem`; audit by day `Query PK=AUDIT#{day}`; access review `Query
GSI1=IDENTS`. Password sign-in `GetItem PK=LOCALUSER#{email}`; setup `GetItem PK=SETUPLINK#{sha256(token)}` (holds the email and a TTL at the link expiry; only the token hash is ever stored); bind
`GetItem` on `SSOEXPECT#OID#{oid}` and `SSOEXPECT#UPN#{upn}`. Unique usage keys use `UsageKeyClaim` in the same
`TransactWriteItems` with `attribute_not_exists(PK)`.

**Storage boundary (D26, amended 2026-11-14).** The access-control store is
replaceable (D21: DynamoDB now, Aurora later):

1. **One layer.** Every read and write of the entities above goes through
   domain functions in `apps/dashboard/lib/data/access/**` (for example
   `createPasswordUser`, `bindToEntra`, `moveAffiliation`, `grantRole`,
   `appendAudit`). Route Handlers, Server Components, `auth.ts` and the
   policy module call only these; none of them sees a key, item shape,
   expression or DynamoDB error type.
2. **Operations own their transactions.** A change and its audit record are
   committed inside one domain function (`TransactWriteItems` today, a SQL
   transaction later); callers never assemble transactions.
3. **Storage-neutral schemas.** The Zod schemas in `packages/shared` describe
   people, memberships, grants and records; the key builders for the
   prefixes above live inside the storage layer, not in `packages/shared`
   (the collector never needs them). Cost-data keys (`ACCT#`, `DAILY#`,
   `SYSTEM`) stay shared. *Amended 2026-11-13 (R2a):* the builders sit in
   `apps/dashboard/lib/data/access/keys.ts`, which holds pure functions only
   and no `server-only` import, so the DynamoDB-Local seed scripts can use
   it; a structural test allows imports of it only from
   `apps/dashboard/lib/data/access/**` and `scripts/**`. R1's `identPk` moves
   there in R2b.
4. **Portable ids and cursors.** Identity ids (`oid`, `local:<uuid>`,
   `master:`) are plain strings; list functions return an opaque, signed
   cursor, never a raw `LastEvaluatedKey`.
5. **Behaviour tests.** Integration tests assert each domain function's
   behaviour (results, uniqueness, atomicity, audit) against DynamoDB Local,
   not item layouts, so the same suite can certify another implementation.

## API routes (additions)

All follow Rule 10.3 and set `Cache-Control: private, no-store`.

| Route | Methods | Permission |
|---|---|---|
| `/api/health` | GET | **None** — the one unauthenticated route; `{ data: { status, dependencies } }` |
| `/api/me`, `/api/me/usage` | GET | Any signed-in role |
| `/api/teams/[id]/visibility`, `/api/departments/[id]/visibility` | GET, PUT | Read in scope; write per matrix |
| `/api/teams/[id]/members` | GET, POST | Per matrix |
| `/api/teams/[id]/members/[oid]` | DELETE | Per matrix |
| `/api/teams/[id]/admins`, `/api/departments/[id]/admins` | GET, POST | Per matrix |
| `/api/teams/[id]/admins/[oid]`, `/api/departments/[id]/admins/[oid]` | DELETE | Per matrix |
| `/api/affiliations/[oid]/move` | POST `{ fromTeamId, toTeamId, version }` | Per matrix |
| `/api/access/org-units` | GET | `internal-admin`, `internal-org-admin`, `internal-auditor` (all), a department-scope admin (its departments and their teams), a team-scope admin (its teams, `departments: []`); everyone else `403` (D37; names sorted ascending): `{ data: { teams: [{ id, name, departmentId }], departments: [{ id, name }] } }` from the account registry (every `AccountMeta` item, active or not, deduplicated by id; sorted by name — teams and departments alike), not from rollups; scope read per request. Feeds the Settings access pickers |
| `/api/role-grants` | GET, POST | `internal-admin` (GET also `internal-auditor`); POST **re-auth** |
| `/api/role-grants/[oid]/[role]` | DELETE | `internal-admin`; **re-auth**; revoking a grant that does not exist → `404` (not `409`; amended 2026-11-15) |
| `/api/group-mappings`, `/api/group-mappings/[groupId]` | GET, POST, PATCH, DELETE | `internal-admin` (GET also `internal-auditor`) |
| `/api/identities`, `/api/identities/[oid]/links` | GET, PUT | `internal-admin` (GET also `internal-auditor`); never opened to scoped admins (D37) |
| `/api/governance/identity-map-rules` | GET, PUT | GET `internal-admin`/`internal-auditor`; PUT `internal-admin` (versioned, audited; D27) |
| `/api/governance/identity-map-rules/suggestions` | GET | `internal-admin`/`internal-auditor`; read-only, not audited; confirming a suggestion is `PUT /api/identities/[oid]/links` (D27) |
| `/api/password-users`, `/api/password-users/[email]` | GET, POST, PATCH, DELETE | `internal-admin` (GET also `internal-auditor`); POST returns the setup link once; POST and DELETE **re-auth**; DELETE takes the user's `version` (optimistic concurrency, *Enforcement* item 6; amended 2026-11-15); PATCH (enable or disable) not |
| `/api/password-users/[email]/reset`, `/api/password-users/[email]/totp-reset` | POST | `internal-admin`; **re-auth** (new setup link once; TOTP re-enrolment at next sign-in) |
| `/api/account/password` | POST | The signed-in password user (own password; current password and TOTP required); another `authMethod` → `403` with a `denied` record (D36). Used by the Account page `/dashboard/account` (D30) |
| `/api/governance/password-sign-in` | GET, PUT | GET `internal-admin`/`internal-auditor`; PUT `internal-admin`, **re-auth** |
| `/api/governance/per-user-approval` | GET, PUT | GET `internal-admin`/`internal-auditor`; PUT `internal-admin` |
| `/api/audit`, `/api/access-review` | GET | `internal-admin`, `internal-auditor` (audited) |

**`/api/me` scope fields (agent decision D-R5-3, 2026-11-16).** `GET
/api/me` also returns the caller's own resolved scope: `global` (boolean),
`memberTeamId` (string or `null`), `memberTeamVisible` (boolean),
`teamScopes` and `departmentScopes` (id arrays). Reason: the My usage page
and the client navigation share one source and no new route is needed (so
nothing new to register). No other person's data appears. The scope is
authorization data and is read per request on the server; the client hook
caches it for at most 60 seconds, so a role or scope change shows in the
navigation and notices within that bound, while every page and route
enforces the current scope regardless.

**Names in management lists (D37).** The `GET` rows of
`/api/teams/[id]/members`, `/api/teams/[id]/admins` and
`/api/departments/[id]/admins` carry `displayName` and `email` from each
bound person's identity (`null` when unknown); pending rows carry their
email or UPN. Only the rows of the requested, in-scope team or department
are returned, so a scoped admin sees the names of the people they manage
and no one else's, without `/api/identities`.

**Error-code registry:** `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`REAUTH_REQUIRED` (403, a **re-auth** write without a sign-in in the last
15 minutes; *Recent authentication*), `BAD_REQUEST` (400), `NOT_FOUND` (404), `CONFLICT`,
`MANAGED_BY_SSO`, `ALREADY_AFFILIATED`, `SSO_BOUND` (409, the password user is bound to Entra; amended 2026-11-14), `WEAK_PASSWORD` (400), `INTERNAL` (500), and from the
[LiteLLM spec](2026-11-10-litellm.md): `OPERATION_DISABLED` (403, operation
toggle off), `OPERATION_UNAVAILABLE` (403, Enterprise-only on OSS, or any
LiteLLM route in `open` mode), `LITELLM_UNAVAILABLE` (503, not configured,
unreachable or rejected upstream), `PRIVILEGED_TARGET` (409, target LiteLLM
user holds a proxy role). A new code is added here first. A bad or foreign list cursor returns `400` `BAD_REQUEST`; `BAD_CURSOR` is internal to `lib/data/access` and never reaches a response (decided 2026-11-14).

## Decisions

| # | Problem | Options | Choice and reason |
|---|---|---|---|
| D1 | How users get team access | explicit in-app affiliation / Entra group owners via Graph / derived from `byUser` | **Explicit affiliation plus SSO group mapping** — no Graph secret, no group-ID code; usage derivation rejected. Graph group-owner membership recorded as a later option |
| D2 | Stale windows | 14 / 30 / 90 days | **30 days pending, 90 days inactive** (quarterly review cycle) |
| D3 | Audit retention | 1 y / 400 d / 7 y | **400 days, both stores** — confirmed (user, 2026-11-14) |
| D4 | Session caps | 8 h for all / shorter for privilege | **8 h; 4 h with `internal-admin`/`internal-org-admin`; 1 h master user** |
| D5 | Visibility defaults | open / least privilege | **team `visible`, user `own`, department `hidden`, cap `own`** |
| D6 | Privacy wording | — | Proposed below — **(user)** with DPO/HR |
| D7 | Local login role without Entra | Admin / Viewer | **`internal-admin` by default** (user, 2026-11-10) |
| D8 | Role of an SSO user with no app role | deny / viewer | **`internal-viewer`** (user); data stays membership-gated; malformed claims fail closed |
| D9 | Managing users without SSO | none / local users | **Local users, local-login mode only** (user) — **superseded by D20** (2026-11-14) |
| D10 | Database | DynamoDB / Aurora Serverless v2 | **DynamoDB** — key lookups, small data, invariant in keys, transactions; Aurora adds a VPC cluster, credentials, migrations, connection handling and resume latency (against shared-contracts §7 minimum resources). **Revisit** on per-request relational reporting, > ~100k identities or SQL access for finance | *Re-examined 2026-11-14 (D21): DynamoDB now, Aurora later behind the D26 boundary.*
| D11 | Role model | four Entra roles / global + scoped (LiteLLM) | **Global `internal-*` + scoped `internal-team-admin`** (user) |
| D12 | Cardinality | multi-team members / single | **Member of ≤ 1 team; `internal-team-admin` on ≥ 1 scopes** (user) |
| D13 | SSO vs UI | UI / SSO / last write | **SSO > UI > none, per item** |
| D14 | Org-wide team administration | only `internal-admin` / separate role | **`internal-org-admin`** (user) — keeps `internal-admin` small |
| D15 | Who grants `internal-admin` | Entra only / also in-app | **Entra or in-app by `internal-admin` only**, with re-auth, reason, audit, alarm (user) |
| D16 | Password login | none / master user | **One master user = `internal-admin`**, Argon2id, TOTP in `prod`, lockout, 1 h (user); amends *Sign-in providers* |
| D17 | Refused write attempts | none / every rejection / authorization refusals only | **Authorization refusals only** (`403 FORBIDDEN`, out-of-scope `404`, `409 PRIVILEGED_TARGET`), recorded as `denied` security events, one per actor and action per minute per task (user, 2026-11-14) — validation errors and conflicts are noise |
| D18 | Ordinary sign-ins | master only / all | **All sign-ins and sign-outs**, not security events (user, 2026-11-14) — who used the dashboard and when |
| D19 | Production before SSO is approved | Entra required / master only / Pre-SSO mode | **Pre-SSO mode**: `prod` without Entra when the master user (with TOTP) is configured; everyone else uses password users; SSO later by configuration only (user, 2026-11-14) |
| D20 | Managing users without SSO | dev-only local users / password users | **Password users in every environment**, admin-created, with the SSO reference stored for later binding (user, 2026-11-14) |
| D21 | Where password users and the access-control data live | Aurora Serverless v2 / DynamoDB | **DynamoDB now, Aurora later** (user, 2026-11-14): the same table as written above; the user accepts Aurora's resume delay and may move the access-control data to it. The move and every action it needs are parked in `docs/future-improvements.md` — *Aurora Serverless v2 for access-control data*; the storage boundary (D26) keeps it a one-layer change |
| D26 | Keeping the store replaceable | DynamoDB-shaped code / storage boundary | **Storage boundary** (*Data model additions*): every access-control read and write goes through domain functions in `apps/dashboard/lib/data/access/**`; nothing outside it sees a key, item or query (user, 2026-11-14) |
| D27 | Session names that are not emails | manual aliases only / fuzzy matching / admin mapping rules | **Admin mapping rules that suggest exact aliases**, confirmed one by one or per rule (user, 2026-11-14) — fast for many users, still exact and auditable |
| D22 | First password | admin-set temporary password / one-time setup link | **One-time setup link** (72 h, single use, fragment, hash stored); the admin never knows the password (user, 2026-11-14) |
| D23 | TOTP for password users | everyone / admin roles / none | **Required for any role above `internal-viewer` or any admin scope**, optional otherwise (user, 2026-11-14) |
| D24 | Password sign-in once Entra is configured | stop at once / switch | **Admin switch, on by default**; bound users are always refused; access review flags enabled password users (user, 2026-11-14) |
| D25 | Matching a password user to Entra | email claim / UPN / object id | **`expectedOid` when set, else `expectedUpn`**, tenant-checked, never the `email` claim or a guest UPN; conflicts flagged, never merged (user, 2026-11-14) |
| D28 | Proving a recent sign-in for global-role grants | `signedInAt` / any re-sign-in / credential time (`auth_time` for Entra) | **`authTime` from the credential check, 15 minutes, set only at sign-in; step-up is a full sign-in through the existing providers** (Entra `prompt=login` + `max_age=900`; password and TOTP otherwise; identifier from the session); `403 REAUTH_REQUIRED` after the role and origin checks, no `denied` record, a span event and later a counter (*Recent authentication*). (agent decision, 2026-11-15: a fresh credential check bounds the life of a stolen session; its open questions (denied record, `auth_time`, scope, cap restart) are resolved by D33) |
| D29 | Other sessions after a password change, reset, disable or delete | end at the cap / revoke | **Revoke:** `credentialVersion` on the `LOCALUSER` item, copied into the JWT at sign-in and checked per request for password sessions (uncached); the changing session gets the new version from the server through the `selfChangeSignedInAt` marker, never from an `update` payload (*Password users*; OWASP / ASVS: invalidate sessions on credential change). (agent decision, 2026-11-15: a stolen or left-open session must not survive a credential change) |
| D30 | Changing one's own password in the UI | route only / Account page | **Account page** `/dashboard/account` for password users, on `POST /api/account/password`; other methods see their sign-in method and no form. (agent decision, 2026-11-15: password users need a self-service change, and the Account page is the least new surface) |
| D31 | A password user who needs TOTP but never enrolled | new enrolment route / admin reset link | **Admin reset link**; its setup flow enrols TOTP when required — reuses the audited admin flow. (agent decision, 2026-11-15: it reuses the audited admin flow and adds no enrolment route) |
| D32 | Last-admin checks | read then write / one transaction | **One `TransactWriteItems`** with a `ConditionCheck` on another enabled admin's items; concurrent removals conflict and one gets `409 CONFLICT` (*Enforcement* item 8; no TOCTOU on a lockout invariant). (agent decision, 2026-11-15: a read-then-write check leaves a lockout race) |
| D33 | D28's open questions | — | **No `denied` record** on `REAUTH_REQUIRED` (a challenge, not a refusal; the step-up sign-in is audited and a span event, later a counter, marks challenges); the **Entra `auth_time` claim** stays a user action (auth guide; fails closed without it); **re-auth extends** to password-user create, reset, TOTP reset and delete and to the password sign-in switch — not group mappings, memberships, visibility or links (sudo-mode practice, ASVS re-authentication before sensitive operations); the **return target** is the starting Settings section from a two-value allowlist; a step-up **restarts the session cap** (a new authentication issues a new session). (agent decision, 2026-11-15: each resolves a D28 question with the sudo-mode and ASVS precedent) |
| D34 | Pending and stale lists in Settings | build now / defer | **Build now, in 4R.4** (user, 2026-11-15, reversing the orchestrator's earlier deferral): a Settings list of pending and stale items with a scoped read route, test-first. The access review keeps flagging stale items |
| D35 | Non-person key and D27 matching | canonicalise the ARN / keep it raw | **`byUser` keeps the raw non-person key; D27 rules match on the session name** (after the last `/` or `:`) — the spec follows the tested code; raw ARNs are stored lower-cased by the links key schema. (agent decision, 2026-11-15: the spec follows the tested code; 2026-11-16: lower-casing recorded) |
| D36 | `POST /api/account/password` from a non-password session | no record / `denied` | **One `denied` record** — it is an authorization refusal (D17). (agent decision, 2026-11-15: a refusal is an authorization event (D17)) |
| D37 | Access pickers and names for scoped admins | rollup teams and bare `oid`s / registry and names | **Pickers read the account registry** through `GET /api/access/org-units`, scoped by the management-read rule; **members and admins rows carry `displayName` and `email`** for in-scope rows; `/api/identities` stays `internal-admin`/`internal-auditor` (least privilege). (agent decision, 2026-11-15: least privilege; approved by the user, 2026-11-15, for in-scope rows only) |

**Proposed privacy wording (D6):** "LLM Usage Lens processes the AWS
sign-in identity and the Amazon Bedrock usage and cost attributed to it, to
allocate AI costs to teams and departments and control spend. The legal
basis is the company's legitimate interest in cost management **[to be
confirmed by the data protection officer]**. Per-user figures are estimates,
shown to the person themselves and — only after works-council /
data-protection approval — to their team or department administrators,
organisation administrators and auditors. Usage rollups are kept for
**[the configured retention]** and audit records for **[400 days]**."

## Threat model

| # | Threat | Mitigation | Test (unit) |
|---|---|---|---|
| T1 | Spoofing: forged or foreign-tenant token | Tenant-specific issuer; `tid` check; missing `oid` fails closed | R1 parser tests |
| T2 | Spoofing: UPN reuse inherits access | Bind once on `tid` + UPN (never `email`, never a guest UPN), then key by `oid` | R2 bind tests |
| T3 | Elevation: scoped admin acts outside scope | `can()` per action; `403` before parsing | R4 write matrix |
| T4 | Elevation: non-`internal-admin` grants a global role | Grant routes `internal-admin` only; mappings cannot target global roles | R1 schema, R4 grant matrix |
| T5 | Elevation: default viewer reaches team data | Data only through member/admin items | R3 "no affiliation" rows |
| T6 | Elevation: usage data grants access | `resolveScope` never reads `byUser` | R3 |
| T7 | Elevation: the dev login used in production or while Entra is configured; a bound password user signs in with the password (amended 2026-11-14) | Env rejection of the dev login, including its identity option; `sso-bound` users refused; password sign-in switch (D24) | R1 (dev login and env rejection); R2 (bound user refused); R4 (switch); L3c (identity option rejected in `prod` and with Entra configured) |
| T8 | Elevation: ambiguous/overage groups give the wrong team | Ambiguous → none; overage → none + scopes suspended | R2 resolver table |
| T9 | Elevation: privilege carried across a move | Move removes source team-scope admin atomically | R4 move test |
| T10 | Tampering: UI overrides SSO-managed item | `409 MANAGED_BY_SSO` | R4 |
| T11 | Tampering: lost update / cross-site write | `version` (`409`); same-origin check | R4 (same-origin check delivered 2026-11-11) |
| T12 | Disclosure: aggregates reveal out-of-scope cost | Aggregate after filtering; scoped org totals | R3 leak tests (perturb out-of-scope team) |
| T13 | Disclosure: department total reconstructed | Department `hidden`; visible totals are sums of visible rows | R3 leak test |
| T14 | Disclosure: cache serves another caller's rows | Scope-independent cache; auth data uncached; `private, no-store` | R3 back-to-back callers; header assertion |
| T15 | Disclosure: id probing | Identical `404` bodies | R3 |
| T16 | Disclosure: per-user data before approval | Organisation cap in `resolveScope` | R3 gate tests (enforcement); R4 (approval switch) |
| T17 | Disclosure: secrets or PII in logs/telemetry | Sanitised audit; id-only OTel; no claims logged | R2 sanitiser test |
| T18 | Repudiation: unrecorded change | Audit semantics (one record per success/failure) | R2/R4 audit tests |
| T19 | Repudiation: audit log edited | Task role `PutItem`-only on `AUDIT#`; CloudWatch copy | R2 CDK assertions on the task-role policy |
| T20 | Spoofing: master credential brute force or theft | Argon2id in SSM, TOTP, lockout, 1 h session, audited + alarm, custody | R1 (hash, TOTP, lockout, 1 h, one id-only security event per attempt); R2 (persistent audit record and its alarm) |
| T21 | Misconfiguration: `open` mode, missing TOTP, or production with neither Entra nor the master user (amended 2026-11-14, D19) | Keyed on validated `APP_ENV=prod`; default `enforce`; unset `APP_ENV` fails validation; `prod` without Entra requires the master user with TOTP; CDK synth refuses neither | R1 env tests; 4R.2 env and CDK tests |
| T22 | Repudiation: probing writes outside one's permissions leaves no trace | `denied` records (D17) with the security alarm; unchanged response and `404` parity; per-minute suppression | R2 (record type, `requireAdmin` refusals); R4 and L4 write matrices (one `denied` per refusal, none on `400`, identical bodies) |
| T23 | Spoofing: password guessing or credential stuffing on password users | Argon2id; per-user lockout; dummy-hash work and one generic error for unknown, disabled, locked or bound users; common-password list; TOTP for admin roles; VPN-only reach | R2 (lockout, timing-equal paths, generic errors); R4 sign-in tests |
| T24 | Spoofing: a setup link is intercepted or reused | 32-byte token in the URL fragment; only its hash stored; 72 h; single use; shown once; reset or delete invalidates; setup audited | R2 (hash only, single use, expiry, invalidation); R4 e2e setup |
| T25 | Disclosure: an admin types the wrong email and the account sees another person's spend | Admin-only creation, audited; the email is shown at setup and in the user menu; uniqueness against identities, usage identities and aliases; access review | R2 uniqueness (`409`); R4 setup page shows the email |
| T26 | Elevation: an Entra identity binds to someone else's password user | Tenant check; `expectedOid` or `expectedUpn` only, never the `email` claim or a guest UPN; unique reservations and `SsoRef`; conflicts flagged, never merged | R2 bind tests (foreign `tid`, `#EXT#`, `email`-only match, duplicate reservation, existing Entra items) |
| T27 | Disclosure or replay of a password user's TOTP secret or code | Envelope-encrypted secret, never returned; last used step stored, reuse refused | R2 (stored value is ciphertext; replayed code refused) |
| T28 | Bypass: password sign-in sidesteps Entra Conditional Access once SSO is live | Bound users refused; password sign-in switch (D24); access review flag | R2 (bound refused); R4 (switch off refuses every password user) |
| T29 | Disclosure: another app, service or principal in the account reads user data (shared subnets, broad IAM) | Platform — *Data isolation*: table resource policy limited to named roles, optional VPC-endpoint condition, CMK key policy, collector limited to cost keys, no inbound path to the tasks except the ALB | 4R.2 CDK assertions (policy present, principal list exact, data-plane actions only) |
| T30 | Elevation: a stolen or unattended `internal-admin` session, or a forged same-site request riding it, grants or revokes a global role | *Recent authentication* (D28): 15-minute `authTime`, step-up by a fresh credential, same-origin check first, the UI never replays a write; `role.grant`/`role.revoke` alarm | R4 (unit `hasRecentAuth` boundaries; role-grant routes fresh / stale / missing per method; order against `401`, `FORBIDDEN`, cross-origin and `400`) |
| T31 | Tampering: the client sets or refreshes `authTime` | Set only in the sign-in branch of the `jwt` callback; the `update` payload never merged; encrypted JWT | R4 (`update` with `authTime` leaves it unchanged; non-sign-in calls keep it) |
| T32 | Spoofing: a step-up satisfied by an existing Entra SSO session, or by stripping `prompt`/`max_age` from the query | Only the verified ID token's `auth_time` counts, never the request parameters or the callback time; missing claim → step-up needed | R4 (Entra sign-in with an old, missing or non-integer `auth_time` gives no recent auth) |
| T33 | Elevation / denial: two concurrent removals leave no `internal-admin` (lockout) | One transaction with a `ConditionCheck` on another enabled admin's items (*Enforcement* item 8, D32) | R4 (concurrent revokes and disables of the last two admins: at least one `409`, an admin remains) |
| T34 | Spoofing: a stolen or left-open password session survives a password change, reset, disable or delete | `credentialVersion` checked per request, uncached; incremented with the change; only the changing session gets the new version, only from the server (D29) | R4 (old version → `401`; changing session stays signed in; `update` cannot raise the version beyond the committed value) |

## Residual risks

- **TOTP replay window:** a TOTP code stays valid for its ±1-step window (about 90 s) and used steps are not recorded, so a code observed in that window could be replayed together with the password. Accepted for v1 (break-glass only, password and lockout still required); recording the last used step on the master identity item is the follow-up.
- **Master user before 4R.2:** R1 emits only id-only telemetry for master-user sign-ins; the persistent audit record and alarm arrive in 4R.2. Do not set `masterUsername` in `prod` before 4R.2 is deployed.
- `dynamodb:LeadingKeys` cannot separate `AccountMeta` (`ACCT#…/META`) from
  rollups (`ACCT#…/DAILY#…`), so the task role can technically write rollup
  items. Accepted for v1 (the shared contract's `ACCOUNT#` is the Data
  Model's `ACCT#`); a key change would be a Data Model amendment.
- `/api/health` is unauthenticated — the one documented exception to Rule
  10.3, allowed by a structural test.
- The master user is a password credential in production; its controls and
  custody (above) are the mitigation.
- **Password users are password credentials in production** (D20), possibly
  for months before SSO. Mitigations: T23–T28, TOTP for admin roles, the
  VPN-only reach and the D24 switch. A regular user without TOTP is protected
  by the password alone; accepted, because they see only their own data and
  what their team visibility allows. No self-service reset (no email
  service): a forgotten password needs an `internal-admin`.
- **Lockout as denial of service:** anyone on the VPN can repeatedly lock the
  master user. Mitigations: lockout per username with an alarm on every
  lockout, reach limited to the VPN, Entra `internal-admin` holders remain
  the primary path, and the runbook covers investigating the source.
  Accepted for v1.
- **Setup-link preview without a session** (accepted, user, 2026-11-15): the setup page's `previewPasswordSetupLink` Server Action
  reads what the link is for (the email shown at setup, T25) before any
  session exists. It is read-only and needs the 256-bit token.
- **Stolen copy of the changing session's token** (D29; recorded 2026-11-15):
  the session that changes its own password adopts the new `credentialVersion`
  through the `selfChangeSignedInAt` marker, which matches that session's
  `signedInAt`. A copy of that same token (same `signedInAt`) taken before the
  change is therefore adopted too and survives the change; every other
  session ends. Mitigations: the 8 h cap, VPN-only reach, and an admin reset
  or disable, which clears the marker.
