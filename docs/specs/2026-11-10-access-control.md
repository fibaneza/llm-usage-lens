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
**department** is LiteLLM's organization level. *Amended 2026-11-17
(management improvements D5, agent decision): a team may also be a
**created app team** with no AWS account (`AppTeam`, *Data model
additions*), created by `internal-admin` or `internal-org-admin` (D6, user).
It belongs to one department and takes members, admin scopes, visibility
and a LiteLLM team link like any team; it has no Bedrock cost.* Permissions are evaluated
top-down and a child level can only **narrow** its parent (*Visibility and
inheritance*).

## Roles

Values are lower-kebab-case, case-sensitive, and live only in
`apps/dashboard/lib/auth/` (Rule 50.3). Entra app-role values carry the
`internal-` prefix.

| Role | Kind | LiteLLM analogue | Source | Reads | Writes |
|---|---|---|---|---|---|
| `internal-admin` | Global; a small named group (≥ 2 people) plus the master user | `proxy_admin` | Entra app role; in-app grant by an `internal-admin`; the master user | Everything | Everything: any team, any user, all configuration. **Only role that grants or revokes `internal-admin` and `internal-org-admin`** |
| `internal-org-admin` | Global | — (between `proxy_admin` and `org_admin`) | Entra app role, or in-app grant by an `internal-admin` | Every team and department | Admin scopes, members, moves and visibility in **any** team or department. **No configuration**, except the LiteLLM operation toggles (incl. reset) and team links (LiteLLM spec LD24; user, 2026-11-16, extending D14); also creates app teams and creates, approves and removes LiteLLM user links, never on themselves (user, 2026-11-17, management improvements D6, D16); no global-role grants |
| `internal-auditor` | Global | `proxy_admin_viewer` | **Entra app role only** | Everything, read-only, incl. the audit log and access review; never key values or secrets | Nothing — every write returns `403` |
| `internal-viewer` | Global; **the default** | `internal_user` | Entra app role, or the default | Own usage (*My usage*); their member team as visibility allows | Nothing |
| `internal-team-admin` | Scoped: **one or more** teams and/or departments, each a separate admin scope | `team_admin` (team scope), `org_admin` (department scope) | UI or SSO group mapping | Everything in its scopes | Members, team-scope admin grants (never on themselves) and visibility in its scopes; with a department scope also moves between that department's teams and the department cap |
| member (no role value) | A plain affiliation to one team | team role `user` | UI or SSO group mapping | The team, as visibility allows | Nothing |

**Configuration** (only `internal-admin`): group mappings, account CRUD
(Phase 4.9), the per-user approval, password users and the password
sign-in switch, the LiteLLM gateway configuration, connection and
edition, LiteLLM team creation, audit retention, identity links. The
LiteLLM operation toggles and team links are also writable by
`internal-org-admin` (LiteLLM spec LD24; user, 2026-11-16). *Amended
2026-11-17 (user, management improvements D16):* within identity links,
the **LiteLLM user link** (`litellmUserId`) is also writable by
`internal-org-admin`; the usage identities and aliases stay
`internal-admin` only (agent decision: the user's answer was about the
LiteLLM link of item 13). App team creation is not configuration: it is a
team write for `internal-admin` and `internal-org-admin` (D6, user).

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
| **Password users** (email + password, amended 2026-11-14) | All environments, while password sign-in is on (*Password users*) | In-app role grants, member team and admin scopes, set in Settings or on the user page (unit US2, 2026-11-24; Design System — *The user page*) |
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

**Team lead sign-in (management improvements D14, agent decision,
2026-11-17; item 1, unit M3; was "dev sign-in as a lead", renamed at the user's direction, 2026-11-18).** A lead is a **scope**, not a global role, so
the role select (`GLOBAL_ROLES`) could not offer it. The form gains a
**Team lead** option that signs in through the stored-identity path above as
the seeded team lead identity (`local:team-lead@localhost`, email
`team-lead@localhost`, renamed at the user's direction, 2026-11-18),
which `pnpm db:seed` stores with a team-scope `internal-team-admin` item on
the first seeded team. The scope comes from the store per request, as for any
stored identity; the typed text and the option never supply a role or a
scope, the session token carries no scope, and no `Lead` app role is
created. When the seeded identity is missing, the option fails with the one
generic failure. The option exists only where the dev login exists (outside
production, Entra not configured; T7). Reason: no new auth path; the lead's
rights are tested as a real stored scope.

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
  KPIs, rankings) only over in-scope data, labelled "your teams". (Under
  review 2026-11-16: the Usage pages are now shown only to organisation-level
  roles; whether a lead keeps any scoped cost view is open — *Navigation and
  landing by role*. The rule stays in force for every scoped read.)
- **Privacy:** per-user cost is personal data; the legal basis and retention
  are a **(user)** decision (DPO/HR) — proposed wording under *Decisions*.

**Evaluation order** — the single `resolveScope` pipeline; any failure
denies (`401`/`403`/`404` per *Enforcement*): (1) token valid (issuer,
`tid`, `oid`, session cap) → (2) global role → (3) member affiliation and
admin scopes (precedence above) → (4) inherited caps → (5)
`can(action, resource)`.

### Navigation and landing by role

*Added 2026-11-16 (user, mock-up review). Pages and routes: Design System —
*Navigation (Sidebar)*, *Management pages*, *Settings Page*.* Role words:
**admin** = `internal-admin`, **org admin** = `internal-org-admin`,
**lead** = `internal-team-admin` (any scope), **user** = `internal-viewer`
and members, **auditor** = `internal-auditor`.

| Sidebar item | admin | org admin | auditor | lead | user |
|---|---|---|---|---|---|
| **Usage** — Overview, Ranking, Cost by department, Cost by team, Cost by service, Cost by user | ✓ | ✓ | ✓ read-only | ✗ (no AWS cost view, decided 2026-11-17) | ✗ |
| Usage — My usage (moved from Management 2026-11-17, user; second in the group, D1) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Usage — Team usage (D7, user, 2026-11-17; global readers: coordinator decision, 2026-11-17, MI-D7; *shown from the M2 merge, 2026-11-18 (`TEAM_USAGE_ROUTE = true`, Design System — D7)*) | ✓ every team | ✓ every team | ✓ every team, read-only | ✓ teams in scope (a live admin scope) | ✗ |
| **Management** — Team | ✓ every team | ✓ every team | ✓ read-only | ✓ teams it leads | ✗ |
| Management — Users | ✓ | ✓ | ✓ read-only | ✗ | ✗ |
| Management — LiteLLM: tabs Organisation, LiteLLM teams, LiteLLM users (D2, agent decision, 2026-11-17; replaces the Organisation item) | ✓ | ✓ | ✓ read-only | ✗ | ✗ |
| Management — Audit | ✓ | ✗ (see below) | ✓ | ✗ | ✗ |
| **Administration** — Settings | ✓ | ✓ (no configuration except the LiteLLM toggles, LD24; team links moved to Management → LiteLLM, D3) | ✓ read-only tabs only | ✗ | ✗ |

- **Decided 2026-11-16 (user):** the Usage group is organisation-level and
  shown to admin and org admin; My usage to every signed-in role (in
  Management then; **moved to the Usage group 2026-11-17, user**, see
  B1-14); Team to lead, org admin and admin; Organisation, Users and Audit to
  org admin and admin; Administration to admin and org admin, last in the
  side panel. **Landing page:** admin and org admin → Cost overview
  (`/dashboard`); lead and user → My usage (`/dashboard/me`). This replaces
  the 4R.5 *My teams* landing for a lead.
- **Auditor** (agent decision, 2026-11-16: the review's table names the
  managing roles only; `internal-auditor` still "reads everything,
  read-only" per *Roles*, so it keeps every read view): Usage, the
  Management read views and Audit, read-only; landing → Cost overview; in
  Administration only the tabs it may read (Settings → LiteLLM read-only).
- **Audit for org admin** (agent decision, 2026-11-16: the review keeps both
  audit sources' permissions as they are — Design System — *Management
  pages*; today neither the app audit log nor the LiteLLM audit is readable
  by `internal-org-admin`): the Audit item renders only for a caller who may
  read at least one source, so an org admin does not see it. Giving org
  admins audit read is a permission change and stays the user's (*Decision
  policy*).
- **Hidden means absent and `404`.** An item the caller may not see is not
  rendered (never disabled), and its route — and any redirect that lands on
  it — returns the same `404` body as a missing page (*Enforcement* item 2;
  Rule 10.3). Visibility is enforced by the policy module on the server for
  every page and Route Handler; the navigation filter only mirrors it.
- **Lead team-scoped actions** keep their permissions (*Permission matrix*,
  unchanged) and move to Management → Team for a lead, who does not see
  Administration (Design System — *Management pages*).
- **Visibility settings** (*Visibility and inheritance*, above) keep
  governing every scoped read route and the Team Detail, Services and
  Ranking data; with the organisation-level Usage items hidden for users, the team-level and
  user-level settings currently have no page that shows them to a user.
  They stay in force and editable; a page that surfaces them to users is a
  later decision.
- **Lead AWS cost view — decided 2026-11-17 (coordinator, under the user's
  delegation; asked 2026-11-16).** A lead has **no** "AWS-billed cost" tile
  and no Bedrock/AWS cost view of its teams: least privilege, and AWS
  billing is account-level, not team-level. The tile (Design System —
  *Management pages*, addition 2) is not built. The lead-scoped read rules
  and Route Handlers from 4R.3 stay in force (the API still filters by
  scope); only the pages are closed.
- **Slice B1 decisions (agent decisions, 2026-11-17; implementation-phases
  — *Phase 5*, Slice B1).**
  - **B1-1** The Usage group is decided on the stored scope's global-reader
    flag (`Scope.global`: admin, org admin, auditor), not the role claim.
    Reason: the scope is what the pages filter on (D-R5-2a).
  - **B1-2** Every Usage route — `/dashboard/ranking`, `/dashboard/departments`
    and `/dashboard/departments/[id]`, `/dashboard/teams` and
    `/dashboard/teams/[id]`, `/dashboard/services`, `/dashboard/users` —
    returns the missing-page `404` to a caller who is not a global reader.
    Reason: the detail routes are drill-downs of hidden items; a hidden
    item's route is never reachable.
  - **B1-3** `/dashboard` and `/dashboard/home` redirect such a caller to
    `/dashboard/me` rather than `404`. Reason: `/dashboard` is the sign-in
    callback target; the Overview content is never rendered for them.
    `?view=overview` has no effect any more (D-R5-1 superseded in code).
  - **B1-4** Landing: global reader → `/dashboard`; everyone else, a lead of
    any scope included → `/dashboard/me` (D-R5-2 superseded in code).
  - **B1-7 Settings stays visible until B2 (coordinator ruling,
    2026-11-17).** The navigation mirrors the server, and the Settings
    route still serves a lead and a user (unit D's interim tabs). B1 keeps
    the Settings item for every signed-in caller; B2 builds the route gate
    (`404` for lead and user) and hides the item in the same change. Until
    then the Administration row above is not yet applied for lead and user.
  - **Management in B1:** the existing LiteLLM item is shown to every
    signed-in caller; B2 replaces it with Team, Organisation, Users and
    Audit per the matrix.
  - **B1-14 My usage is a Usage item (user, 2026-11-17, screenshot
    review).** My usage sits last in the Usage group and is shown to every
    signed-in caller. The Usage group therefore renders for everyone: a
    global reader sees all seven items, a lead or a user sees only My
    usage. B1-1 and B1-2 still hold for the six organisation-level items
    and their routes; `/dashboard/me` is never gated. Position (agent
    decision): last, so Overview stays first for a global reader, whose
    landing it is. *Position superseded 2026-11-17 (user, management
    improvements MI-D1): My usage is second, after Overview, and Team
    usage third. "A lead or a user sees only My usage" superseded
    2026-11-17 (user, MI-D7: "Team lead is also a user"): a lead with a
    live admin scope sees My usage and Team usage (Team usage was hidden until M2 landed its page; shown from 2026-11-18, `TEAM_USAGE_ROUTE = true`, Design System — D7); a user sees only My
    usage; a global reader sees all eight items (Team usage included,
    MI-D7). The rest of B1-14 holds.*
- **Slice B2 decisions (agent decisions, 2026-11-17; implementation-phases
  — *Phase 5*, Slice B2).**
  - **B2-1 One server capability function.** `managementAccessFor(session)`
    (`lib/manage-access.ts`, server-only, never cached) decides every
    Management and Settings item from the stored roles and the live scope:
    Team for a global reader or a live lead (team or department scope);
    Organisation and Users for a global reader; Audit for a caller who may
    read the app audit log (the Access capability `auditLog`) or the
    LiteLLM audit (admin, auditor); Settings for a global reader. Each page
    calls it and returns the missing-page `404` when its flag is false; the
    navigation renders the same flags. A read error fails closed (every
    flag false). Reason: one decision for page and nav, as B1-8.
    *Amended 2026-11-17 (MI-D2, MI-D7): the `organisation` flag becomes
    `litellm` (the LiteLLM area, same rule) and `teamUsage` is added.*
  - **B2-2** Settings is hidden for a lead and a user and every Settings
    route returns `404` to them (the B1-7 deferral, now applied). The
    lead's team-scoped access actions (members, team admins, pending
    access, visibility) are mounted on Management → Team, through the same
    Access sections and routes.
  - **B2-3 Redirects.** `/dashboard/litellm` follows `?tab=` (`team`,
    `organisation`, `users`, `audit` → the matching `/dashboard/manage/`
    route; anything else → `/dashboard/me`); `/dashboard/litellm/team-config`
    → `/dashboard/manage/team`, keeping `?team=` (*from 2026-11-23, unit TM1: `/dashboard/manage/team?team=<id>` in turn redirects to `/dashboard/manage/team/<id>`, so the team-config URL lands there in two steps*); `/dashboard/settings/audit`
    → `/dashboard/manage/audit`. A temporary redirect (reversible); a
    target the caller may not see returns `404` there. *Amended 2026-11-17
    (MI-D3): `?tab=organisation` now lands on
    `/dashboard/manage/litellm/organisation`, and
    `/dashboard/manage/organisation` redirects there.*
  - **LiteLLM item removed** from Management once its views have routes.

- **Management improvements decisions (2026-11-17; units M1–M3; Design
  System — *Management improvements*).** User decisions are marked; the
  others are agent decisions (Rule 00.3).
  - **MI-D1 Order (user, Q1).** Usage: Overview, My usage, Team usage,
    Ranking, Cost by department, Cost by team, Cost by service, Cost by
    user. Management: Users, Team, LiteLLM, Audit. Supersedes B1-14's
    position ("last"); who sees each existing item is unchanged. A lead's
    Usage group is My usage, Team usage; its landing stays My usage (B1-4).
  - **MI-D2 LiteLLM area (agent decision, 2026-11-17, items 2 and 10).**
    `/dashboard/manage/litellm/{organisation,teams,users}`, for admin,
    org-admin and auditor (read-only); absent and `404` for a lead and a
    user. The capability is the `litellm` flag of `managementAccessFor`,
    which replaces its `organisation` flag (same rule: a global reader).
    Reason: it follows the user's Management order (MI-D1: LiteLLM holds
    Organisation); the callers are those who see Organisation today.
  - **MI-D3 Settings → LiteLLM keeps configuration only (agent
    decision, 2026-11-17).** Team links and
    Users move to MI-D2; the old URLs redirect on the server (Design System
    — *Routes and redirects*). Reason: management views belong under
    Management, configuration under Administration (the 2026-11-16 split).
  - **MI-D4 No permission change with the move (agent decision,
    2026-11-17).** Team-link writes stay
    `internal-admin` and `internal-org-admin` (LD24), which is what item 4
    asks for; LiteLLM team creation stays `internal-admin`. Reason: the move
    changes where a control is, never who may use it.
  - **MI-D7 Team usage and the `teamUsage` flag (user, Q3: "Team lead is
    also a user").** `managementAccessFor` gains `teamUsage: boolean`, true
    when the caller is a global reader (admin, org-admin, auditor) or holds
    at least one live admin scope (team or department; a suspended SSO
    scope does not count); a read failure closes it with every other flag.
    The sidebar item and `/dashboard/team-usage` both follow it. The page's
    team list is every team for a global reader, and otherwise only the
    teams of the caller's scopes (a department scope covers its teams,
    created teams included by their stored department); a team outside it,
    or a caller without the flag, gets the missing-page `404`.
    - **Global readers (coordinator decision, 2026-11-17, under the user's
      delegation; supersedes the agent decision of the same day that gave
      them the item only through a scope they hold).** Admin, org-admin
      and auditor may open Team usage for **any** team, since they already
      read every team (`GET /api/litellm/teams/[teamId]`). The Organisation
      tab's `open-team` row links to Team usage (`?team=<id>`), and Cost by
      team's LiteLLM panel offers "Sum of members" on request, both through
      the same `GET /api/litellm/teams/[teamId]?include=memberSum` (App
      Teams spec — AT6). Reason: one reader per figure, so no new route —
      the member sum has one route, and the place it moved to from the Team
      page must be reachable by the callers who read it there.
    - **The sidebar item for a global reader (coordinator decision,
      2026-11-17, under the user's delegation): shown.** A global reader
      without a scope sees the Team usage item too. Reason: the page and
      the nav follow one flag (B2-1); an item whose route the caller may
      open is never hidden, and a hidden item's route is always `404`
      (Design System — *Navigation (Sidebar)*).
    - M1 adds the flag and the item; M2 builds the page and reads the flag.

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
An invite that does not bind at sign-in can be accepted by a manager
(*Accept a pending invite*, below).

**Accept a pending invite (unit INV1; user, 2026-11-18: "Admin and team
lead should be able to accept a 'sent by them' invitation to the team").**
For an invite that did not bind at sign-in — a UPN that differs from the
key, a guest (`#EXT#`), or two pending invites for different teams — a
manager binds the pending **member** invitation to an identity that has
already signed in, so the person becomes a member now (user decision,
2026-11-18). Pending admin scopes are not accepted this way (agent
decision, 2026-11-18: the request was about team membership; an admin
scope stays a grant). Rules:
- **Who (user, 2026-11-18):** the person who sent the invite, any lead
  whose scope covers the team, `internal-org-admin` and `internal-admin` —
  the roles of the add-member row. The sender may accept only while they
  still hold that permission on the team (agent decision, 2026-11-18:
  "sent by them" never outlives the scope it was sent under, BR4
  precedent): the sender is a subset of those roles, never an extra role.
- **Target:** an existing identity (signed in at least once) in the
  configured tenant, chosen from a server-computed candidate list, never
  typed. Candidates are identities with no member team whose UPN equals
  the pending key, whose guest UPN encodes it (`jane_example.com#EXT#@…`
  for `jane@example.com`), or whose stored email equals it (agent decision,
  2026-11-18: a lead gets no free search over people, D37; the email is a
  candidate signal only, shown for a human decision, never a bind key).
  `internal-admin` and `internal-org-admin`, who already read the identity
  directory, may also pick from it. The dialog shows the key against the
  identity's UPN and email before confirming, with the mismatch marked.
- **Refusals:** the invitee accepting their own invite (target `oid` = caller)
  `403 FORBIDDEN`; a target holding any global role (claims ∪ stored grants)
  `409 PRIVILEGED_TARGET`; a target in another tenant, or not found, `404`;
  a target with an SSO-sourced affiliation `409 MANAGED_BY_SSO`; a target
  already in a team `409 ALREADY_AFFILIATED`; a stale `version` `409
  CONFLICT`; an invite no longer pending `409 CONFLICT` only when the
  target already holds this team (a replay), otherwise the missing-key
  `404` (*Details*; amended 2026-11-18, INV1 review Q-B1); a team outside
  the caller's scope, a key not pending for that team, the same `404` body
  as a missing one.
- **Write:** one `TransactWriteItems` — delete the pending item (conditional
  on its `version`), write the affiliation keyed by `oid` (UI-sourced,
  conditional on no affiliation), and write the `affiliation.invite.accept`
  audit record (actor, pending key, team, target `oid`, reason, result). A
  required reason of 1–280 characters. Authorization data: never cached
  (Rule 60.10).
- **Details (agent decisions, 2026-11-18, INV1 red stage):** a replay finds
  the pending item gone, so the route answers `409 CONFLICT` when the target
  already holds the affiliation on this team, else the missing-key `404`
  (T-INV4 with T-INV5); "a global role" for the privileged refusal is
  `internal-admin`, `internal-org-admin` or `internal-auditor` by claim or
  stored grant (`internal-viewer` is everyone's default); the self-accept
  `403` comes before the privileged `409`; an admin-scope pending key is the
  missing-key `404`; `?q=` from a lead is ignored; for `internal-admin` and
  `internal-org-admin` `?q=` returns directory matches of `q` (in the
  tenant, unaffiliated) instead of the key candidates; the key in the path
  matches case-insensitively, and a malformed key is `400`. The candidate
  read writes no audit record. Every refused accept writes one `denied`
  record (*Audit log*, D17), the self-accept `403` and the
  `PRIVILEGED_TARGET` `409` included, as on M3's link and create routes
  (orchestrator ruling, 2026-11-18, INV1 green stage). A lead naming an
  `oid` outside the candidate set is an authorization refusal (D17, T22
  probing): one `denied` record (`NOT_FOUND`) and the same `404` body
  (coordinator ruling, 2026-11-18, INV1 review Q-W1). With no Entra tenant
  configured the candidate and directory reads return no rows and no
  accept can name a target (fail closed; agent decision, 2026-11-18). Check
  order: the permission `403` and the out-of-scope team `404` (before
  parsing) → body and key `400` → self-accept `403` → the pending member
  key `404` (or the replay `409`) → the target: for a lead (not
  `internal-admin` or `internal-org-admin`) the candidate-set check runs
  first, so an unknown, a foreign-tenant and a same-tenant non-candidate
  `oid` share one path — the same `404` body and one `denied` record
  (`NOT_FOUND`), no existence oracle (amended 2026-11-18, INV1 review
  R2-B1; D17, T22); for `internal-admin` and `internal-org-admin` the
  target must be an identity in the tenant (`404`) → privileged `409` →
  the bind (`409` conflicts).

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
| Accept a pending invite (bind to a signed-in identity; unit INV1, user, 2026-11-18) — never one's own invite | ✓ | ✓ any team | ✓ teams in scope | ✓ teams in scope | ✗ |
| Grant or remove a team-scope `internal-team-admin` | ✓ | ✓ any team | ✓ teams in scope | ✓ teams in scope; never their own scope (grant or remove) | ✗ |
| Grant or remove a department-scope `internal-team-admin` | ✓ | ✓ | ✗ | ✗ | ✗ |
| Remove a member | ✓ | ✓ any team | ✓ teams in scope | ✓ teams in scope | ✗ |
| Move a member to another team | ✓ | ✓ | ✓ both teams in scope | ✗ (remove; the destination admin adds) | ✗ |
| Edit visibility | ✓ | ✓ | ✓ dept, its cap and its teams | ✓ teams in scope | ✗ |
| Grant or revoke `internal-org-admin` / `internal-admin` | ✓ **only** | ✗ | ✗ | ✗ | ✗ |
| LiteLLM operation toggles (incl. reset) and team links (LiteLLM LD24; user, 2026-11-16, extending D14) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Read one person's global roles and usage identities on the user page (`GET /api/identities/[oid]`; unit US2, D-US11 — **the user's decision, 2026-11-23**; read only: the writes stay in the `internal-admin` rows; `internal-auditor` reads too) | ✓ | ✓ read only | ✗ | ✗ | ✗ (auditor ✓ read) |
| Create an app team (`POST /api/teams`; management improvements D6, user, 2026-11-17) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Create, approve or remove a person's LiteLLM user link (`litellmUserId`; never on their own identity; D16, user, 2026-11-17) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Configuration (everything else in *Configuration* above) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Request a budget reset for **one's own** member budget (unit M4; MG-D11; user, 2026-11-17) | ✓ own, as a member of a linked team | ✓ own, as a member of a linked team | ✓ own, as a member of a linked team | ✓ own, as a member of a linked team | member of a linked team: ✓ own; `internal-auditor` ✗; no member team ✗ |
| Approve or deny a budget reset request (unit M4; MG-D12) — never one's own request | ✓ | ✓ any team | ✓ teams in scope | ✓ teams in scope | ✗ |
| Reset a member's spend or budget by LiteLLM ids (`POST /api/litellm/proxy-teams/[litellmTeamId]/members/[litellmUserId]/reset-spend`, `/reset-budget`; unit RS2, user, 2026-11-19; LiteLLM LD39) | ✓ every LiteLLM team, linked or not | ✓ every LiteLLM team, linked or not | ✓ members of the LiteLLM team linked to a team in scope; else `403` | ✓ same | `internal-auditor` ✗ (`403`); member, viewer ✗ |
| Reset a LiteLLM user's spend across all of LiteLLM (`POST /api/litellm/users/[litellmUserId]/reset-spend`; RS2, user: Q17 "Admin and org-admin" for a user in no team, Q19 "leads too") | ✓ any LiteLLM user (linked or not, in a team or not) | ✓ any LiteLLM user | ✓ only a user who is a member of a LiteLLM team linked to a team in scope; otherwise `404`, the unknown-user body | ✓ same | `internal-auditor` ✗ (`403`); member, viewer ✗ |
| Read a LiteLLM team's members (`GET /api/litellm/proxy-teams/[litellmTeamId]/members`; RS2, D-RS6) | ✓ | ✓ | ✗ `403` | ✗ `403` | `internal-auditor` ✓ (reads, resets nothing); member, viewer ✗ |

**Reset by LiteLLM ids (unit RS2; added 2026-11-19; LiteLLM spec LD39).**
The three write routes and the one read above are keyed by LiteLLM ids, so
a LiteLLM user with no app identity, or a member of an unlinked LiteLLM
team, can be reset. Each checks, in order: the session (`401`), the matrix
permission (`403` before parsing, one `denied` record), the path ids, the
operation toggle, then the target. A target outside the caller's reach is
the same `404` body as a missing one (LiteLLM LT5): a Lead learns nothing about
people outside their teams. A privileged LiteLLM user or the service user is
`409 PRIVILEGED_TARGET` with no write. The `oid` routes (`/api/litellm/teams/[teamId]/members/[oid]/reset-spend`,
`/reset-budget`) keep their matrix rows and M4's approvals still use them.
Each reset writes one audit record and one ledger item (Data Model —
*BudgetReset*); a reset with no `oid` counts for nobody. New audit action
`litellm.user.reset-spend` (spend before and after), appended to
`AUDIT_ACTIONS` with the existing `litellm.member.reset-spend`.

*Tests (T-RS1–T-RS8; source: implementation-phases — RS2, plan 2026-11-18 §3 RS2; threat rows LT35–LT37).*

| Test | Proves |
|---|---|
| T-RS1 | The gateway sends `/user/update` with exactly `user_id` and `spend: 0`; any other field or value fails the schema and nothing is sent (LT35). A structure test: `/user/update` is used by `resetUserSpend` only, `/user/delete` by nothing |
| T-RS2 | The user-level route: admin and org-admin `200` for a linked user, an unlinked user and a user in no team; a Lead `200` for a member of a team in their scope, and `404` (the unknown-user body) for a user in no team or only in other teams; an auditor `403` before parsing, with one `denied` record; the operation off `403` |
| T-RS3 | The member routes: a Lead in scope `200` for a member with no app identity; a Lead out of scope, or on an unlinked LiteLLM team, `403`; org-admin and admin `200` on a linked and on an unlinked team |
| T-RS4 | A user who is not a member of that team, or an unknown id: `404` with the same body, no LiteLLM write (LT37) |
| T-RS5 | A privileged LiteLLM user or the service user (by its `proxy_admin` role): `409 PRIVILEGED_TARGET`, no write (LT36) |
| T-RS6 | Each reset writes one audit record and one ledger item, also with no `oid`; the `oid` routes and M4's approval still pass the ledger contract |
| T-RS7 | UI: the button on every LiteLLM users row; a LiteLLM team's members with the two actions for admin and org-admin and none for the auditor; no button while the operation is off; the lead's Team-page reset, both scopes |
| T-RS8 | The members read: admin, org-admin, auditor `200`; a lead `403`; at most 200 members, `truncated: true` above |

**Budget reset requests (unit M4; added 2026-11-17; MG-D11 to MG-D13 in the
[LiteLLM spec](2026-11-10-litellm.md)).** A request is a new write for a
role that writes nothing today, so it has its own row and its own toggle
(`requestBudgetReset`, default on; a request alone changes nothing in
LiteLLM). The requester is the caller's own member affiliation, never a
body field; a caller with no member team gets `403` before parsing with one
`denied` record. `internal-auditor` stays read-only and cannot request
(*Roles*). Approve and deny reuse the `member` matrix write of the reset
routes (`lib/api/matrix-route.ts`, `decideWrite`), so a request or a
notification never widens who may reset (BR1); the requester is refused
`403` even when in scope (BR2). Every check runs **at the decision** (BR4).
In `prod`, before the per-user approval, the team list read shows the
requester's name, email and reason only to the deciders; the Auditor sees
counts only (LiteLLM spec MG-D12, amended 2026-11-18, Q-W2).
Role × operation, signed in (`401` everywhere unsigned, asserted by the
route-contract suite); "Lead" has a team or department scope on the
request's team, "member" is a plain affiliation to that team:

| Route | Admin | org-admin | Auditor | Lead | Lead, other team | member | Viewer, no team |
|---|---|---|---|---|---|---|---|
| `POST /api/budget-reset-requests` (own member team) | ✓ if a member of a linked team, else `403` | as Admin | 403 | as Admin | as Admin | ✓ | 403 |
| `GET /api/budget-reset-requests?teamId=` | ✓ | ✓ | ✓ | ✓ | 404 | 404 | 404 |
| `GET /api/budget-reset-requests/mine` | ✓ own | ✓ own | ✓ own | ✓ own | ✓ own | ✓ own | ✓ own (`eligibility.reason: "no-team"`) |
| `POST /api/budget-reset-requests/[id]/approve`, `/deny` | ✓ | ✓ | 403 | ✓ | 404 | 403 | 403 |
| the requester, whatever the role, on their own request | 403 | 403 | 403 | 403 | — | 403 | — |
| `GET /api/notifications`, `POST /api/notifications/read` | ✓ own | ✓ own | ✓ own | ✓ own | ✓ own | ✓ own | ✓ own |
| `GET /api/budget-resets` (slice B, MG-D10) | ✓ every team | ✓ every team | ✓ every team | ✓ teams in scope | other teams absent | own only | own only |

New audit actions (appended to `AUDIT_ACTIONS`, `packages/shared`):
`budgetreset.request.create`, `budgetreset.request.approve`,
`budgetreset.request.deny`. An approval also writes the existing
`litellm.member.reset-spend` record (the LiteLLM change, actor = the
approver). Expiry and mark-read are not audited (no person acts; own state).
No new error code: `409 CONFLICT` (an open request exists, the request is
not open, the team is not linked, the person is not a member of the LiteLLM
team), `403 FORBIDDEN`, `403 OPERATION_DISABLED`, `404 NOT_FOUND`.

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

**LiteLLM user links (management improvements D16, 2026-11-17; unit M3).**
*Amends "per `oid`, `internal-admin` only" for `litellmUserId`.* The
LiteLLM user link is written by `internal-admin` or `internal-org-admin`
(user, Q4) through `PUT`/`DELETE /api/identities/[oid]/litellm-link`; the
usage identities and aliases stay `internal-admin` through
`PUT /api/identities/[oid]/links`. ~~Both routes write `litellmUserId`
through one domain function, so the same rules hold:~~ *Amended
2026-11-18 (M3 review B1, agent decision under the coordinator's ruling):*
only the `litellm-link` routes set, change or remove `litellmUserId`.
`PUT /api/identities/[oid]/links` refuses a `litellmUserId` that differs
from the stored one (setting a first one, changing it, or dropping it)
with `409 CONFLICT` pointing to the `litellm-link` route — nothing is
written, including on the caller's own `oid` (the own-`oid` `403` stays on
the `litellm-link` routes, where the link can change); an unchanged id
passes through with an alias or usage-identity edit. Reason: one write
path for the link, so the rules below always hold:

- **One-to-one.** A `LiteLLMUserClaim` item (*Data model additions*) is
  written in the same transaction as the link and its audit record; a
  LiteLLM user already claimed by another identity returns `409 CONFLICT`.
- **Never on oneself** (agent decision: the precedent "never on themselves",
  *Roles*): a caller linking or unlinking their own `oid` gets `403
  FORBIDDEN` before parsing, with one `denied` record.
- **Match** (`mode: "match"`): the LiteLLM user's `user_email`, read by
  the server with `getUser`, equals the identity's verified canonical email,
  else `409`. It is shown as a suggestion and written only after an
  approval click in a dialog that names both sides; nothing is linked
  automatically (D27).
- **Manual** (`mode: "manual"`, emails differ): a written reason of 1–280
  characters is required (`400` without it) and stored in the audit record.
- **Privileged targets refused:** a LiteLLM user whose `user_role` is not
  `internal_user` or `internal_user_viewer`, or the service user, returns
  `409 PRIVILEGED_TARGET` (LiteLLM spec LT18), because the link shows that
  user's spend and key metadata to the person.
- **Recent authentication:** the link routes keep the rule
  `PUT /api/identities/[oid]/links` has today — none (D33 excludes links).
- Each write is audited (`identity.litellm-link.set` /
  `identity.litellm-link.remove`, with mode, both ids and the reason); the
  auditor reads.
- (agent decision, 2026-11-18, unit M3: the audit action names and the snapshot keys `mode` and `reason` are added to the shared lists so the record carries them, T17.)
- (agent decision, 2026-11-18, unit M3: the link item keeps the last `mode` and `reason`, so a remove audits them in `before`; they never leave the server.)
- (agent decision, 2026-11-18, unit M3: every write of a link that holds a `litellmUserId` also puts its claim, which adds the missing claim of a link stored before M3; releasing a claim that does not exist is not a conflict.)
- (agent decision, 2026-11-18, unit M3: the own-`oid` refusal of the link routes reads the path `oid` in the permission step, before the body is parsed, and writes one `denied` record; `POST /api/litellm/users` does it after parsing, the `oid` being in the body.)
- (agent decision, 2026-11-18, unit M3: each directory row carries `linkVersion`, the `IdentityLink` version the link writes must send; an unlinked row reads 0.)
- (agent decision, 2026-11-18, unit M3: like every LiteLLM route, the link writes answer `403 OPERATION_UNAVAILABLE` in open access mode, LT11.)

**Created app teams (management improvements D5, D6, 2026-11-17; unit M2).**
`POST /api/teams` creates an `AppTeam` (*Data model additions*):
`internal-admin` and `internal-org-admin` only (user, Q2), everyone else
`403 FORBIDDEN` before parsing (one `denied` record); body `{ name,
departmentId }`, the name 1–80 characters after trimming, unique
case-insensitively among created teams (an `AppTeamNameClaim` in the same
transaction) and among the registry's team names (`409 CONFLICT`); the
department must exist in the account registry (`400`). **The clash is
refused both ways (agent decision, 2026-11-17, M0 review round 1):**
`POST /api/accounts` and `PATCH /api/accounts/[id]` also refuse a
`teamName` that equals a created team's name case-insensitively after
trimming (`409 CONFLICT`, no write; the account routes read the
`AppTeamNameClaim`). A registry account that keeps its `teamId` and its
current `teamName` is not refused. Reason: otherwise a later account could
take a created team's name and two teams would show the same name in
every picker (T-MI3). The id is generated
on the server, `appteam-<uuid v4>`, never taken from the body, and the
registry refuses a `teamId` with the reserved `appteam-` prefix (Data Model
— *AccountMeta*), so it can never equal a registry team. The create and its
`appteam.create` audit record are one transaction; the route revalidates
the team-list tags. A created team appears in `GET /api/access/org-units`,
can take members, admin scopes, visibility and a LiteLLM team link, and is
covered by a department scope through its stored `departmentId` (live, not
per day: it has no rollups). Create only: rename and delete are in
`docs/future-improvements.md`.

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
   **Effective global roles** are the token claims ∪ the stored
   `ROLEGRANT` items, for every caller, read per request and never cached,
   so a revoked grant takes effect on the next request. *Fix, 2026-11-18
   (unit M3, coordinator ruling; found by the M3 `mayLink` test):*
   `loadAuthorization` skipped the grant read when the claim was already a
   global reader, so an auditor claim lost a stored `internal-org-admin`
   grant; it now always reads the grants. Nothing else changes: the legacy
   `Admin` alias stays gated outside `APP_ENV=prod`, and group mappings
   never grant global roles.
2. **Status codes.** Out-of-scope and nonexistent details return `404` with
   an **identical body**. An unauthorised write returns `403` before input
   parsing. Lists contain only in-scope rows. *Named for the team page
   (unit TM1, 2026-11-23; Design System — *Management pages*, List, then
   the team):* `/dashboard/manage/team/[teamId]` is `404` with the
   missing-team body for a team outside the caller's scope (a lead: neither
   one of its team scopes nor in one of its department scopes) and for an
   unknown id; the list at `/dashboard/manage/team` holds only in-scope
   teams, and the `?team=` redirect lands on the same `404`. The team
   page's pending and stale lists use the optional `teamId` query of
   `GET /api/access/pending` and `GET /api/access/stale`, which narrows the
   already scoped rows and never widens them (TM1 review, Q-B3).
3. **Aggregates after filtering.** Every total, "% of Total", count, top-N,
   most-used model, trend and comparison uses only in-scope rollups and
   attribution; nothing out of scope is inferable from the difference of two
   visible numbers.
4. **Caching cannot leak.** `unstable_cache` stays scope-independent (raw
   rollups per UTC day); filtering runs after the read, outside the cache.
   **Authorization data is never cached** (roles, grants, affiliations,
   scopes, mappings, visibility, links, the approval), so changes apply on
   the next request on every task with no `revalidateTag`; no cross-task
   invalidation is relied on. The cached account list is not authorization
   data, but it places accounts in teams and departments, so a moved account
   stays visible to its old team's Lead on the other task for up to 1 hour
   (Data Model — *Access Patterns*, PERF-1 residual risk; 2026-11-17). The
   cached created-team list (tag `app-teams`) carries the same residual
   risk: a created team's name or department seen on another task can be up
   to 1 hour stale (organisation data only; M2, 2026-11-18).
   Every Route Handler response under `/api/*`
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
`PATCH` (enable or disable, and the name edit of unit US2, 2026-11-24), the per-user
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
    `/dashboard/settings/access/roles#role-grants` and
    `/dashboard/settings/access/sign-in#password-users` (the table above;
    D33). The action takes a section key (`role-grants` | `password-users`),
    never a URL; any other value is refused. There is no return-URL
    parameter. The Settings split (2026-11-16, Design System — *Settings
    Page*) moved the sections onto tab routes, so the allowlist URLs changed
    from the earlier `/dashboard/settings#role-grants` and
    `/dashboard/settings#password-users`; the section keys are unchanged.
    The fragment is best-effort (D33a): the step-up lands on the tab URL
    directly and the anchor scrolls when the section is present. The Settings
    hash resolver remains only for old `/dashboard/settings#<slug>` links.
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
  bind, invite accept — `affiliation.invite.accept`, unit INV1), admin scopes, visibility, identity links, password users (create, setup,
  reset, TOTP reset, disable, delete, own password change, bind), the
  password sign-in switch, accounts, the approval, sign-ins and sign-outs, denied write attempts, and the
  LiteLLM actions (LiteLLM spec — *Audit*), including the gateway
  configuration (`litellm.gateway.update`, LiteLLM unit L6, 2026-11-17),
  and the LiteLLM user links and user creation
  (`identity.litellm-link.set`, `identity.litellm-link.remove`,
  `litellm.user.create`, with the snapshot keys `mode` and `reason`;
  unit M3, 2026-11-18). No snapshot holds a secret or a key value
  (`createUser` sends `auto_create_key: false`).
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
| AppTeam (management improvements D5, 2026-11-17) | `APPTEAM#{teamId}` | `META` | `APPTEAMS` | `APPTEAM#{teamId}` |
| AppTeamNameClaim (uniqueness of the name) | `APPTEAMNAME#{lower(trim(name))}` | `OWNER` | — | — |
| LiteLLMUserClaim (uniqueness of `litellmUserId`, D16) | `LITELLMUSER#{litellmUserId}` | `OWNER` | — | — |

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
`GetItem` on `SSOEXPECT#OID#{oid}` and `SSOEXPECT#UPN#{upn}`. Created
teams `Query GSI1=APPTEAMS` (paginated, Rule 20.6); one team `GetItem
PK=APPTEAM#{teamId}`. An `AppTeam` holds `teamId`, `name`, `departmentId`,
`departmentName` (the registry's name at creation), `createdBy` (`oid`),
`createdAt` and `version`; it goes through the storage boundary below
(`lib/data/access/app-teams.ts`). Unique usage keys use `UsageKeyClaim` in the same
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
| `/api/teams/[id]/members/pending/[key]/accept` | POST `{ oid, reason }` (strict) | Per matrix (accept a pending invite); `403` before parsing without the permission; rules in *Accept a pending invite* (unit INV1) |
| `/api/teams/[id]/members/pending/[key]/candidates` | GET (`?q=` for `internal-admin` and `internal-org-admin` only) | Per matrix (accept a pending invite); the candidate identities of *Accept a pending invite*, at most 10, `oid`, display name, UPN and email only (unit INV1) |
| `/api/teams/[id]/admins`, `/api/departments/[id]/admins` | GET, POST | Per matrix |
| `/api/teams/[id]/admins/[oid]`, `/api/departments/[id]/admins/[oid]` | DELETE | Per matrix |
| `/api/affiliations/[oid]/move` | POST `{ fromTeamId, toTeamId, version }` | Per matrix |
| `/api/access/org-units` | GET | `internal-admin`, `internal-org-admin`, `internal-auditor` (all), a department-scope admin (its departments and their teams), a team-scope admin (its teams, `departments: []`); everyone else `403` (D37; names sorted ascending): `{ data: { teams: [{ id, name, departmentId }], departments: [{ id, name }] } }` from the account registry (every `AccountMeta` item, active or not, deduplicated by id; sorted by name — teams and departments alike), not from rollups; scope read per request. Feeds the Settings access pickers. *Amended 2026-11-17 (management improvements D5):* `teams[]` also lists the created app teams (`AppTeam`), each row gaining `hasAwsAccount` (`false` for a created team); a scoped admin sees a created team when its scope covers it |
| `/api/role-grants` | GET, POST | `internal-admin` (GET also `internal-auditor`); POST **re-auth** |
| `/api/role-grants/[oid]/[role]` | DELETE | `internal-admin`; **re-auth**; revoking a grant that does not exist → `404` (not `409`; amended 2026-11-15) |
| `/api/group-mappings`, `/api/group-mappings/[groupId]` | GET, POST, PATCH, DELETE | `internal-admin` (GET also `internal-auditor`) |
| `/api/identities`, `/api/identities/[oid]/links` | GET, PUT | `internal-admin` (GET also `internal-auditor`); never opened to scoped admins (D37) |
| `/api/identities/directory` | GET | `internal-admin`, `internal-org-admin`, `internal-auditor`; everyone else `403`. From 2026-11-23 (unit ST1, D-ST2; user, 2026-11-18) the route takes `q` (Zod, trimmed, 1–100 characters), a search by name, email or UPN that returns at most 10 results, for the same callers, through `searchIdentities(q, limit)` in `lib/data/access/identities.ts` (server cap 10; GSI1 `IDENTS` pages until the limit, never a Scan; only rows the unfiltered directory shows; no cursor; agent decision with the coordinator's ruling, 2026-11-23, reason: the route stays off access keys and store internals); a lead still gets no people search (D37) and is `403`. Reason: the Settings identity pickers become a search box. The people list of Management → Users and the LiteLLM users tab (management improvements D15, D16, 2026-11-17; *LF1, 2026-11-24: the tab no longer reads this route's link state — it shows the link state in the selected user's detail from the `GET /api/litellm/users` list rows, and the directory serves Management → Users*): per identity `oid`, `displayName`, `email`, `authMethod`, `memberTeamId`, and the LiteLLM link state (`linked` with `litellmUserId`, or `none`); with `?include=litellmMatch` each unlinked row on the page also carries `match` from `findUserByEmail` on its verified email (read only, nothing written). 25 rows a page, opaque cursor; no usage identities or aliases. Agent decision: org-admin approves LiteLLM user links (user, Q4) and needs to see whom it links; it already manages every team, and D37's restriction is about scoped admins. From 2026-11-24 (unit US1, D-US3, D-US3a; user, 2026-11-18): the list takes `sort` (Zod enum `name`, `email`, `createdAt`, `lastSignInAt`, `team`; default `name`) and `dir` (`asc`, `desc`; default `asc`); any other value is `400`. The route reads at most 2,000 identities per request, sorts them in memory with a stable tie-break on `oid` (the precedent of Rule 20.7 for bounded lists), then pages 25 rows; over the bound the response carries `truncated: true` (otherwise `false`). A row without the sort value (no `createdAt` on a record written before US2, no team for `team`) sorts last in both directions. `team` sorts by the team's display name, else its id. The cursor encodes the sort and the direction, so a cursor from another sort or direction is `400`. Each row also carries `createdAt` (when the record has it) and `lastSignInAt`. `q` keeps its own search path (at most 10, no cursor) and takes no `sort`. Nothing of the list is cached (Rule 60.10); a lead is still `403`. Agent decisions (2026-11-24, US1): the empty-sort-value rule, the team sort value, and `q` without sort, because a search result of at most 10 needs no order and the bound keeps the in-memory sort cheap. The cursor is a signed offset into the list as sorted on each request (no snapshot), so a person added or removed between two page reads can shift a row by one place; accepted, because the list is bounded, read by three roles and refreshed on the next load (agent decision, 2026-11-24, US1). `sort=team` reads each listed person's affiliation (at most 2,000, 20 at a time) to order by team; the other sorts read affiliations only for the 25 rows of the page. When `truncated` is `true`, the order is partial: only the first 2,000 identities in GSI1 `IDENTS` order are sorted, and the panel says so (agent decision, 2026-11-24, US1 round 2). **D-US2a** (planner decision, 2026-11-23, Rule 00.3): a person's record carries `createdAt`, written once at the first sign-in and never changed (written since unit US2); a record written before that has none, its Created cell reads "—" and it sorts last in both directions. No backfill, because the true date is unknown and `lastSignInAt` is not it. **D-US3a** (planner decision, 2026-11-23): the record has no `updatedAt`, so that sort key is dropped (superseding the plan's D-US3 list) and `lastSignInAt`, which every record has, replaces it; the keys are `name`, `email`, `createdAt`, `lastSignInAt`, `team`, each a column the three readers see. |
| `/api/identities/[oid]` | GET | `internal-admin`, `internal-org-admin`, `internal-auditor`; everyone else `403`; an unknown `oid` `404` (unit US2, D-US6, 2026-11-23). One person for the user page (Design System — *Management pages*, *The user page*): `oid`, `displayName`, `email`, `upn`, `authMethod`, `createdAt`, `lastSignInAt`, the team membership and lead scope, the LiteLLM link state, usage identities and aliases and global role grants (admin, auditor, and org-admin read-only: the user, 2026-11-23, D-US11), and — **absent otherwise (D-US12)** — a password user's SSO reference and bound date (admin, auditor; not in an org-admin's body). Never a password hash, a TOTP secret, a lockout state, a setup token or the tenant id. Read per request, never cached (Rule 60.10). The response carries the caller's allowed actions on that person, computed on the server from the effective roles, so the page offers only those, and the `version` of each item a write route takes (agent decision, 2026-11-24, US2). |
| `/api/identities/[oid]/litellm-link` | PUT `{ litellmUserId, mode: "match" \| "manual", reason?, version }`, DELETE `{ version }` | `internal-admin`, `internal-org-admin`; own `oid` `403`; rules in *LiteLLM user links* (D16) |
| `/api/teams` | POST `{ name, departmentId }` | `internal-admin`, `internal-org-admin`; `201` with the `AppTeam`; rules in *Created app teams* (D5, D6). `GET /api/teams` stays the Bedrock team list (Data Model — *API Routes*) |
| `/api/governance/identity-map-rules` | GET, PUT | GET `internal-admin`/`internal-auditor`; PUT `internal-admin` (versioned, audited; D27) |
| `/api/governance/identity-map-rules/suggestions` | GET | `internal-admin`/`internal-auditor`; read-only, not audited; confirming a suggestion is `PUT /api/identities/[oid]/links` (D27) |
| `/api/password-users`, `/api/password-users/[email]` | GET, POST, PATCH, DELETE | `internal-admin` (GET also `internal-auditor`); POST returns the setup link once; POST and DELETE **re-auth**; DELETE takes the user's `version` (optimistic concurrency, *Enforcement* item 6; amended 2026-11-15); PATCH (enable or disable; and, from unit US2, 2026-11-23, `displayName` with the user's `version` — the name only, never the email, never an SSO-bound user, audited; a stale `version` is `409`, coordinator ruling Q-B1, 2026-11-24) not |
| `/api/password-users/[email]/reset`, `/api/password-users/[email]/totp-reset` | POST | `internal-admin`; **re-auth** (new setup link once; TOTP re-enrolment at next sign-in) |
| `/api/account/password` | POST | The signed-in password user (own password; current password and TOTP required); another `authMethod` → `403` with a `denied` record (D36). Used by the Account page `/dashboard/account` (D30) |
| `/api/governance/password-sign-in` | GET, PUT | GET `internal-admin`/`internal-auditor`; PUT `internal-admin`, **re-auth** |
| `/api/governance/per-user-approval` | GET, PUT | GET `internal-admin`/`internal-auditor`; PUT `internal-admin` |
| `/api/audit`, `/api/access-review` | GET | `internal-admin`, `internal-auditor` (audited) |
| `/api/litellm/users/[litellmUserId]/reset-spend`, `/api/litellm/proxy-teams/[litellmTeamId]/members/[litellmUserId]/reset-spend`, `/reset-budget` (POST), `/api/litellm/proxy-teams/[litellmTeamId]/members` (GET) (unit RS2, 2026-11-19) | GET, POST | Per *Reset by LiteLLM ids* under *Permission matrix*; LiteLLM spec — *API routes* |
| `/api/budget-reset-requests`, `/api/budget-reset-requests/mine`, `/api/budget-reset-requests/[id]/approve`, `/deny`, `/api/notifications`, `/api/notifications/read`, `/api/budget-resets` (unit M4, 2026-11-17) | GET, POST | Per *Budget reset requests* under *Permission matrix*; shapes in the [Data Model spec](2026-05-15-data-model.md) — *API Routes* |

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

**`/api/me` `leadEmail` and own usage `byModel` (agent decisions, Slice B2,
2026-11-17; coordinator approved the overlap).** Both fields are additive
and optional.
- `leadEmail` (string or `null`): at most one email, of a lead of the
  caller's **own member team** — a team-scope admin of that team from the
  stored admin scopes, read per request and never cached (Rule 60.10).
  `null` when the caller has no member team or no such lead is known.
  Never a list, never another team's lead, never a global admin. A
  **global admin** here is any holder of a global role — `internal-admin`,
  `internal-org-admin`, `internal-auditor`, or the legacy `Admin` alias
  outside `APP_ENV=prod` — by stored grant or last-seen roles. An SSO
  admin scope suspended during a groups overage (*Group overage* item 6)
  does not count; a failed lookup returns `null` and is recorded, never
  failing the whole response (B2 review, 2026-11-17). Reason:
  My usage's "Request a budget increase" link addresses the caller's lead
  (Design System — *Management pages*) and no other route exposes it; one
  address limits what a member learns about other people.
- `byModel` on `GET /api/me/usage`: the caller's own usage per canonical
  model, under the same scope and Organisation-cap rules as the existing
  fields (LD23, LD27 apply to anything per-user); its costs sum to the own
  total. Reason: My usage's spend-by-model breakdown, without a new route.

**Names in management lists (D37).** The `GET` rows of
`/api/teams/[id]/members`, `/api/teams/[id]/admins` and
`/api/departments/[id]/admins` carry `displayName` and `email` from each
bound person's identity (`null` when unknown); pending rows carry their
email or UPN. Only the rows of the requested, in-scope team or department
are returned, so a scoped admin sees the names of the people they manage
and no one else's, without `/api/identities`.
*Amended 2026-11-24 (unit US2, D-US11, the user's decision of
2026-11-23):* the global readers (`internal-admin`, `internal-org-admin`,
`internal-auditor`) read one person through `GET /api/identities/[oid]`,
which for `internal-org-admin` includes the global roles and usage
identities read-only; scoped admins still never read `/api/identities`.

**Error-code registry:** `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`REAUTH_REQUIRED` (403, a **re-auth** write without a sign-in in the last
15 minutes; *Recent authentication*), `BAD_REQUEST` (400), `NOT_FOUND` (404), `CONFLICT`,
`MANAGED_BY_SSO`, `ALREADY_AFFILIATED`, `SSO_BOUND` (409, the password user is bound to Entra; amended 2026-11-14), `WEAK_PASSWORD` (400), `INTERNAL` (500), and from the
[LiteLLM spec](2026-11-10-litellm.md): `OPERATION_DISABLED` (403, operation
toggle off), `OPERATION_UNAVAILABLE` (403, Enterprise-only on OSS, or any
LiteLLM route in `open` mode), `LITELLM_UNAVAILABLE` (503, not configured,
unreachable or rejected upstream), `PRIVILEGED_TARGET` (409, target LiteLLM
user holds a proxy role), `TOO_MANY_MEMBERS` (422, an app team above 200 members
on the member-sum view; LiteLLM spec, L4b, LD34), and from the [System Architecture spec](2026-05-15-system-architecture.md) — *Configuration file*: `CONFIG_FILE_LOCKED` (409, the setting is set in `config.yaml`; added 2026-11-17, unit CFG). A new code is added here first. A bad or foreign list cursor returns `400` `BAD_REQUEST`; `BAD_CURSOR` is internal to `lib/data/access` and never reaches a response (decided 2026-11-14).

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
| D33a | Where the step-up returns | the starting section's `#section` fragment as a hard requirement / the final Settings tab URL | **The step-up returns to the final Settings tab URL; the `#section` fragment is best-effort**, because Next drops fragments on server-action redirects. Landing on the tab satisfies D33, since the tab holds the section. (agent decision, coordinator, 2026-11-17, under the user's delegation: the framework cannot carry the fragment and the tab already shows the section)  |
| D34 | Pending and stale lists in Settings | build now / defer | **Build now, in 4R.4** (user, 2026-11-15, reversing the orchestrator's earlier deferral): a Settings list of pending and stale items with a scoped read route, test-first. The access review keeps flagging stale items |
| D35 | Non-person key and D27 matching | canonicalise the ARN / keep it raw | **`byUser` keeps the raw non-person key; D27 rules match on the session name** (after the last `/` or `:`) — the spec follows the tested code; raw ARNs are stored lower-cased by the links key schema. (agent decision, 2026-11-15: the spec follows the tested code; 2026-11-16: lower-casing recorded) |
| D36 | `POST /api/account/password` from a non-password session | no record / `denied` | **One `denied` record** — it is an authorization refusal (D17). (agent decision, 2026-11-15: a refusal is an authorization event (D17)) |
| D37 | Access pickers and names for scoped admins | rollup teams and bare `oid`s / registry and names | **Pickers read the account registry** through `GET /api/access/org-units`, scoped by the management-read rule; **members and admins rows carry `displayName` and `email`** for in-scope rows; `/api/identities` stays `internal-admin`/`internal-auditor` (least privilege). (agent decision, 2026-11-15: least privilege; approved by the user, 2026-11-15, for in-scope rows only) |
| BP-D8 | Cookies on a host shared with another application (unit BP, added 2026-11-17) | `Path=/` everywhere / path-scope only / path-scope and app-specific names | **With a prefix, every cookie the app sets carries `Path=<prefix>`**, so the browser does not send it to the other application. The installed `next-auth` names its CSRF cookie `__Host-authjs.csrf-token` in secure mode, and `__Host-` is only accepted with `Path=/`, so path scoping needs another name (refined by BP-D12). (agent decision, 2026-11-17: requirement 3 of unit BP; security pass in the review) |
| BP-D10 | `authorized` under a prefix (unit BP, added 2026-11-17) | rely on Next's `nextUrl` / strip in `authorized` | **`authorized` (in `auth.ts`) strips the prefix from `nextUrl.pathname` itself and returns an explicit prefixed sign-in redirect.** With `AUTH_URL` set, next-auth rebuilds the request without Next's config, so `pathname` carries the prefix and `basePath` is empty; unchanged code would give an unauthenticated API call an unprefixed redirect instead of the JSON `401`. (agent decision, 2026-11-17) |
| BP-D11 | Redirects after sign-in, sign-out and error (unit BP, added 2026-11-17) | Auth.js default callback / one custom `redirect` callback | **One custom Auth.js `redirect` callback.** A relative URL gets the prefix. An absolute URL is accepted only if it is the same origin **and** inside the prefix (path equals the prefix or starts with `<prefix>/`). Anything else goes to `<prefix>/dashboard`, the existing landing. The same callback runs with no prefix: a refused URL then goes to `/dashboard` (previously the site root) and unparsable input falls back instead of throwing — stricter, never off the origin, the one intended change to the no-prefix behaviour. `pages.signIn` and `pages.error` carry the prefix. Reason: the default callback accepts any same-origin path, including the other application's paths, so a crafted `redirectTo` could leave the prefix. (agent decision, 2026-11-17) |
| BP-D12 | Cookie names under a prefix (unit BP, refines BP-D8; added 2026-11-17) | default names / path only / path and app-specific names | **With a prefix set, every Auth.js cookie gets `Path=<prefix>` and the name `llm-lens.<suffix>`** (`session-token`, `callback-url`, `csrf-token`, `pkce.code_verifier`, `state`, `nonce`), with `__Secure-` added statically when `AUTH_URL` is https and never `__Host-`. **A prefixed deployment must set an https `AUTH_URL`**: without it the cookies carry neither `Secure` nor `__Secure-` (pinned by `auth.base-path.test.ts`); the POC rule-mode steps set it. **Without a prefix, cookies are unchanged** (default names, `Path=/`). Reason: `__Host-` requires `Path=/`; a custom name loses the automatic `__Secure-`; the other application's `Path=/` cookies still reach `<prefix>/*` and the cookie parser keeps the first duplicate, so names must not collide. The e2e session forge takes the name and path from the same module as the auth config. `sidebar_state` (client cookie, `components/ui/sidebar.tsx`) also gets `path=<prefix>` when set. (agent decision, 2026-11-17) |
| BP-D14 | Redirect base and form under a prefix (unit BP, added 2026-11-17) | request origin / `AUTH_URL` origin; relative / absolute `Location` | **With a prefix set, the `redirect` callback resolves against the `AUTH_URL` origin, and `authorized` returns an absolute `Location` (`<prefix>/sign-in?callbackUrl=<prefixed path>`).** Without a prefix, behaviour is unchanged. Reason: Next normalises a loopback request host to `localhost`, so the configured origin is the stable same-origin reference; Next's proxy rejects a relative `Location`. The sign-out menu item keeps its form mounted on select (`components/layout/UserMenu.tsx`), because the menu closing unmounted the form before it submitted and sign-out never ran — a defect found by the prefixed e2e, present with or without a prefix. (agent decision, 2026-11-17) |

The unit's other decisions (BP-D1 to BP-D7, BP-D9, BP-D13, Q1 to Q3) are in [Platform — *Base path*](2026-11-10-platform.md).

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
| T35 | Elevation: `config.yaml` used as a privilege path — granting a role, naming an admin, widening the LiteLLM gateway or disabling a sign-in protection (added 2026-11-17, unit CFG) | Strict `AppConfigSchema` with no authorization, identity-provider or dev-login branch; operations accept `enabled: false` only (Q1, Q2); the file's "never" list (System Architecture — *Configuration file*) | CFG schema tests: each authorization key, `enabled: true`, an unknown key → rejected and the server does not start |
| T36 | Information disclosure: a secret baked into an image layer through the config file (added 2026-11-17, unit CFG) | Secret-shaped keys rejected by the schema; secrets stay in SSM/env (Rule 50.6); gitleaks scans the checked-in file | CFG schema test (secret-shaped key → rejected, message names the path, never the value); gitleaks green on `config/config.yaml` |
| T37 | Repudiation / tampering: silent drift — an operator cannot tell a file-set value from a stored one (added 2026-11-17, unit CFG) | Every effective value shows its source (`ui` \| `file` \| `spec`) and a "Set in config.yaml" badge; startup emits the file-set key paths (names only, never values) through OpenTelemetry | CFG component test (badge and disabled control on a file-set setting); loader test (key paths listed, no values) |
| T38 | Denial of service / tampering: parser attacks on the YAML file (alias expansion, custom tags, merge keys, duplicate keys, oversize file) (added 2026-11-17, unit CFG) | `yaml` with the core schema, no custom tags, no merge keys, no anchors or aliases, duplicate keys an error, 64 KiB cap before parsing | CFG loader tests (each construct and an oversize file → start refused) |
| T39 | Tampering: a stale or crafted browser write changes a file-locked setting (added 2026-11-17, unit CFG) | The server refuses the write with `409 CONFIG_FILE_LOCKED` after `401`/`403`/`400`, before any DynamoDB write, with one `denied` audit; the UI's disabled control is not the control | CFG route test (`PUT /api/litellm/toggles` naming a file-set operation → `409`, item unchanged, one `denied` record) |
| T40 | Elevation: a cookie of ours reaches, or one of the other application's collides with, a session on a shared host (added 2026-11-17, unit BP) | With a prefix every cookie has `Path=<prefix>` and an app-specific `llm-lens.*` name, `__Secure-` when https, never `__Host-` (BP-D8, BP-D12); without a prefix cookies are unchanged | BP T8 (every `Set-Cookie` has `Path=<prefix>` and an `llm-lens.` name; none without a prefix); BP e2e (forged session cookie added with `domain` + `path`) |
| T41 | Redirect: an open redirect out of the prefix or the host through `redirectTo`, `callbackUrl` or the step-up return path (added 2026-11-17, unit BP) | The custom `redirect` callback accepts only same-origin URLs inside the prefix, else `<prefix>/dashboard` (BP-D11); `pages.*` carry the prefix | BP T7 (sign-in lands on `<prefix>/dashboard`, sign-out on `<prefix>/sign-in`, step-up and callback stay inside the prefix; an outside path, another origin and `/llm-lens-other` are refused) |
| T42 | Spoofing / disclosure: a password setup link leaves the prefix or trusts a forged host (added 2026-11-17, unit BP) | `setupLink()` builds `https://<request Host><prefix>/account/setup#<token>`; the token stays in the fragment (T24) | BP T4 (prefix present, request `Host` still used) |
| T43 | Bypass: an unauthenticated API call under the prefix is redirected to an unprefixed page instead of the JSON `401` (added 2026-11-17, unit BP) | `authorized` strips the prefix itself and returns an explicit prefixed sign-in redirect for pages; API paths keep the `401` JSON shape (BP-D10) | BP T6 (API route `401` JSON; page redirect to `<prefix>/sign-in`; with and without `AUTH_URL`) |
| T-MI1 | Disclosure: a wrong LiteLLM user link shows one person another person's LiteLLM spend and key metadata (management improvements D16, 2026-11-17) — more likely now that org-admin may link | Verified canonical email for a match; approval click in a dialog naming both sides; a required reason for a manual link; one-to-one `LiteLLMUserClaim`; no self-link; privileged targets refused; admin and org-admin only; audited with the reason | M3: org-admin and admin may link, auditor and lead `403`; own `oid` `403` with one `denied`; no automatic link; match with another email `409`; manual without reason `400`; duplicate `409`; a `proxy_admin`, `proxy_admin_viewer` or service-user target `409 PRIVILEGED_TARGET` with no link written; the audit record carries the mode, both ids and the reason (manual) for set and remove; usage aliases stay admin-only |
| T-MI2 | Elevation: the team lead sign-in (D14; was "dev lead sign-in", renamed at the user's direction, 2026-11-18) exists outside dev, or a typed value supplies a scope or role | The option is part of the dev login: env-rejected in `prod` and with Entra configured (T7); the scope comes only from the stored identity's admin-scope item, per request | M3: the option signs in with the stored scope and none from typed text; refused in `prod` and with Entra configured |
| T-MI3 | Tampering: a created app team takes a registry team's id or name, inheriting its members, scopes or spend (D5) | Server-generated `appteam-<uuid>` id; the registry refuses the reserved prefix; name claim and registry name check (`409`), both ways: the account routes refuse a created team's name (`409`) | M2: id never equals a registry team; duplicate name `409` (against created and registry teams); body id refused (`400`, strict body; agent decision, 2026-11-18, M2 build — stronger than "ignored"); `POST /api/accounts` and `PATCH /api/accounts/[id]` with a created team's name `409`, no write |
| T-MI4 | Disclosure: Team usage shows a lead another team's spend (D7) | `teamUsage` and the team list come from `resolveScope` per request; a team outside the scope is the missing-page `404`; only a global reader gets every team (MI-D7, coordinator decision) | M2: leak test (a lead sees only teams in scope; another team's id `404`); a global reader without a scope sees every team; a user with no scope `404` |
| T-US1 | Disclosure: the user page aggregates one person's access (roles, links, sign-in reference) and shows a reader more than Settings would (unit US2, 2026-11-23) | One read for the three global readers only; each block follows the capability that guards it in Settings, except the org-admin read of global roles and usage identities that the user decided for this page (D-US11, 2026-11-23; read only); the SSO reference stays absent for an org-admin (D-US12), and an absent block is absent from the response, not hidden in the page; no credential, hash, secret, lockout state or tenant id in any body; every write goes to its existing route with its own check; no own-role or own-link edit | US2: admin, org-admin, auditor `200`, lead and user `403`, unknown `oid` `404`; an org-admin body has the global roles and usage identities and no SSO reference, and the write routes behind them answer an org-admin `403`; no hash, secret, lockout or tenant id for any role; own page offers no role or link write; no LiteLLM user or member add or remove (zero calls on the fake) |

**Budget reset requests (unit M4; added 2026-11-17).** Each item has its
test in the M4 Verify list (implementation-phases — *M4*).

| # | Threat | Mitigation | Test (unit) |
|---|---|---|---|
| BR1 | Elevation: a request or a notification widens who may reset (a notified person, or the request itself, is taken as permission) | Approve and deny are the `member` matrix write of the reset routes; recipients are never read for authorization | M4 slice A role × operation matrix, including a recipient who lost scope (`404`, no LiteLLM call) |
| BR2 | Elevation: self-approval — a Lead, org-admin or Admin approves their own request | `requesterOid === session oid` → `403 FORBIDDEN` with one `denied` record, before any LiteLLM call | M4 slice A (each deciding role on its own request) |
| BR3 | Tampering: replay or double approval resets twice | Conditional `open → approving` with `version`; the loser gets `409 CONFLICT` | M4 slice A (two concurrent approvals: one `reset_spend` call, one ledger item, one `409`) |
| BR4 | Elevation: a decision after the decider's scope, the requester's membership, the team link or a toggle changed | Every check re-runs at the decision from uncached authorization data (Rule 60.10) | M4 slice A (each of the four changed between request and decision) |
| BR5 | Disclosure: probing request ids or notification ids of another team or person | Out-of-scope and missing requests give the same `404` body; notification keys are built from the session `oid`, so a foreign id is never read or changed | M4 slice A (foreign request id → identical `404`; foreign notification id → unchanged and not listed) |
| BR6 | Denial / nuisance: request spam; an expired request revived and approved | One open request per person per team (claim item), 7-day expiry, 280-character reason; the ledger and the count are the record (no limit on approved resets, user Q5). A claim owned by another request counts as released on expiry, and `beginApproval` requires `requestExpiresAt > now` (LiteLLM spec MG-D12a, amended 2026-11-18) | M4 slice A (second open request → `409`; after expiry a new one is accepted; R1 expires unread, R2 is created: R1 reads `expired`, the open list holds only R2, approving R1 → `409` with no `reset_spend` call) |
| BR7 | Injection: the request reason as stored text (markup in the bell, the Team page, the dialog or an audit view) | Zod: plain text, 1–280 characters, control characters rejected; rendered as React text only, never as HTML, a URL or a `mailto:`; not copied into notifications or audit records | M4 slice A (a reason with `<script>` and `<img onerror>` renders literally; 281 characters → `400`) |
| BR8 | Disclosure: a notification shows a request after its recipient lost access | A notification stores ids only; the list joins the request and shows details and buttons only while the caller may still read and decide it | M4 slice A (recipient loses scope → the item shows no name, reason or buttons) |
| BR9 | Integrity: a LiteLLM failure is reported as approved | `approving → open` on failure, the reset audited `failed`, no notification, no ledger item | M4 slice A (fake LiteLLM `500`: request open, no notification, no ledger) |
| T-INV1 | Spoofing: binding the wrong person to an invite (unit INV1) | Server-computed candidates only (UPN, guest UPN, stored email of signed-in, unaffiliated identities in the configured tenant); the key-against-UPN/email mismatch shown before confirming; required reason; audited | INV1: an `oid` outside the candidate set (for a lead) `404` with one `denied` record, or outside the tenant `404`; no tenant configured → no candidates; no free-text target in the body schema; the audit carries the key, the `oid` and the reason |
| T-INV2 | Elevation: the invitee accepts their own invite | target `oid` = session `oid` `403` | INV1: self-accept `403`, no write |
| T-INV3 | Elevation: an invite binds a privileged identity | a target with a global role (claims ∪ grants) `409 PRIVILEGED_TARGET` | INV1: an `internal-admin`-granted target `409`, no write |
| T-INV4 | Tampering: a stale or replayed accept binds twice | conditional delete on the pending `version`; affiliation written only if none | INV1: a second accept `409 CONFLICT`; two concurrent accepts bind once, the other `409`; one affiliation, one audit |
| T-INV5 | Disclosure / elevation: a lead accepts for a team outside its scope, or probes keys | the matrix row; out-of-scope team or unknown key the same `404` | INV1: a lead of another team `404`, same body as a missing key |
| T-INV6 | Tampering: accept overrides SSO-managed membership | `409 MANAGED_BY_SSO`; `409 ALREADY_AFFILIATED` | INV1: both, no write |
| BR10 | Disclosure: reset counts and amounts reveal another person's or another team's usage | One scoped read, filtered after the read; per-member figures only with the per-user approval in `prod`; visibility rules apply | M4 slice B leak tests (a user never sees another person's, a Lead never another team's; only team totals before the approval) |

## Residual risks

- **Invite candidates read the identity list per dialog open (unit INV1,
  2026-11-18).** The candidate and directory reads scan the identities
  (O(directory), at most 10 rows returned) each time the accept dialog
  opens. Accepted for v1: accepts are rare, manual and limited to
  managers; a key-indexed lookup is the fix if the directory grows large.

- **Budget reset stuck in `approving` (unit M4, MG-D12a; added 2026-11-17):** if the process stops after LiteLLM reset the spend and before the ledger transaction, the request stays `approving`, the reset is in LiteLLM's records and the dashboard audit has no `success` record for it. It is not reopened automatically (a second approval would reset spend accrued since). An Admin resolves it from the Team page list and LiteLLM's own audit. Accepted for v1.
- **Notification fallback recipients (unit M4, MG-D13):** an Entra-only `internal-admin` or `internal-org-admin` who has never signed in has no last-seen role and is not notified when a team has no lead; the request still shows on the Team page. Accepted for v1.
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
- **LiteLLM user links written before the claim item (management
  improvements D16, 2026-11-17).** Links stored before unit M3 have no
  `LiteLLMUserClaim`; the first write after M3 that touches such a link adds
  its claim, and until then a duplicate written before M3 is not refused.
  Mitigation: the access review lists each identity's LiteLLM link, so a
  duplicate is visible; v1 has few links (local and pre-SSO).
