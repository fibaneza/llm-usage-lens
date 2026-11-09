# Authentication Setup Guide

**Scope:** Setting up dashboard authentication (Auth.js + Microsoft Entra ID) and AWS credentials for local development.

---

## Two Separate Credential Concerns

Do not confuse these:

| Concern | What it is | How it is handled |
|---|---|---|
| **Dashboard login** | How users sign into the dashboard | Auth.js (NextAuth v5) + Microsoft Entra ID (dev-only local login outside production — see below) |
| **App → AWS credentials** | How the Next.js server authenticates to DynamoDB | AWS SDK default credential chain (see below) |

## AWS Credentials for Local Development

- **Against DynamoDB Local** (the default for development) — no AWS account is needed. DynamoDB Local accepts dummy credentials.
- **Against real AWS DynamoDB** — use AWS SSO. Run `aws sso login --profile <name>`, set `AWS_PROFILE=<name>`, and the AWS SDK picks up the temporary SSO credentials automatically via its default credential chain.

Do not use static `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Short-lived SSO credentials are the standard practice. (A hosted dashboard on a provider without IAM roles is a pending spec decision — see `docs/guides/dashboard-deployment.md` §2.)

---

## Auth.js + Microsoft Entra ID — Step by Step

### 1. Register the app in Microsoft Entra ID

- Create a free Entra tenant if you do not have one (Azure portal → Microsoft Entra ID).
- App registrations → **New registration**. Name it; pick "Single tenant".
- Redirect URI → platform **Web** → `http://localhost:3000/api/auth/callback/microsoft-entra-id`
- Copy the **Application (client) ID** and **Directory (tenant) ID**.
- Certificates & secrets → **New client secret** → copy the secret **value** (shown once).
- App roles → **Create app role**: display name "Admin", allowed member types **Users/Groups**, value `Admin`. Then Enterprise applications → this app → Users and groups → assign the people who may manage accounts in Settings (assigning a group requires Entra ID P1/P2; on a free tenant assign users directly). Roles are read at sign-in, so a change takes effect at the user's next sign-in; every session ends 8 hours after sign-in, even for an active user. The first deploy of this rule signs everyone out once (older sessions carry no sign-in time). Entra emits assigned roles in the ID token's `roles` claim; members without `Admin` can still read every page but get `403` from the account write routes (System Architecture spec — *Authentication & Access*).

### 2. Install Auth.js

From `apps/dashboard` (or `pnpm add next-auth@beta --filter dashboard` from repo root):

```
pnpm add next-auth@beta
```

### 3. Environment variables (`apps/dashboard/.env.local`)

```
AUTH_SECRET=                # generate with: npx auth secret
AUTH_URL=http://localhost:3000
AUTH_MICROSOFT_ENTRA_ID_ID=<application/client id>
AUTH_MICROSOFT_ENTRA_ID_SECRET=<client secret value>
AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/<tenant id>/v2.0
```

The three `AUTH_MICROSOFT_ENTRA_ID_*` variables are optional **as a group**: set all three or none. Production requires them (System Architecture spec — *Authentication & Access*). The issuer must name your tenant ID as a lowercase GUID, exactly as the portal shows the Directory (tenant) ID; `common`, `organizations` and `consumers` are rejected.

### 4. `apps/dashboard/auth.ts`

The snippet below shows the Entra-only shape. The shipped `auth.ts` registers providers conditionally — see *Dev-only local login* below.

Auth.js v5 auto-reads the `AUTH_MICROSOFT_ENTRA_ID_*` variables from the dashboard app env.

```ts
import NextAuth from "next-auth"
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [MicrosoftEntraID],
  callbacks: {
    authorized: ({ auth }) => !!auth, // gates matched routes in proxy
  },
})
```

### 5. Auth route handler — `apps/dashboard/app/api/auth/[...nextauth]/route.ts`

```ts
import { handlers } from "@/auth"
export const { GET, POST } = handlers
```

### 6. `apps/dashboard/proxy.ts`

Protects the dashboard and API routes, excluding the auth routes themselves.
(Next.js 16 renamed the `middleware` file convention to `proxy`.)

```ts
export { auth as proxy } from "@/auth"

export const config = {
  matcher: ["/dashboard/:path*", "/api/((?!auth).*)"],
}
```

### 7. Sign-in page — `apps/dashboard/app/sign-in/page.tsx`

The shipped page renders one action per configured provider (`components/auth/SignInOptions.tsx`); the snippet shows the Entra-only shape.

```tsx
import { signIn } from "@/auth"

export default function SignInPage() {
  return (
    <form
      action={async () => {
        "use server"
        await signIn("microsoft-entra-id", { redirectTo: "/dashboard" })
      }}
    >
      <button type="submit">Sign in with Microsoft</button>
    </form>
  )
}
```

### 8. Read the session

- **Server Component / Route Handler:** `const session = await auth()` → `session?.user`
- **Client Component:** wrap with `<SessionProvider>`, then `useSession()` — used by the top-bar user menu.
- **Sign out:** a form calling the `signOut()` server action.

### 9. Run and test

```
pnpm dev
```

Run from the repo root (workspace script targets `apps/dashboard`) or from `apps/dashboard`. Visit `/dashboard` → redirected to `/sign-in` → "Sign in with Microsoft" → Entra login → back to `/dashboard`.

---

## Dev-only local login (no Entra tenant)

Decided 2026-10-29 (System Architecture spec — *Authentication & Access*). To run the dashboard locally without an Entra tenant, leave the three `AUTH_MICROSOFT_ENTRA_ID_*` variables unset and add:

```
AUTH_DEV_LOGIN=true
```

- `auth.ts` then registers an Auth.js Credentials provider that signs in a local identity without a password (JWT session). It is registered only when `NODE_ENV !== "production"` **and** `AUTH_DEV_LOGIN=true`.
- The default local identity is an administrator, so Settings works locally: today it carries `Admin`; from Phase 4R it carries `internal-admin`. From Phase 4R an `internal-admin` can add local users and set their roles while Entra is not configured (see *Role-based access* below).
- The sign-in page lists only the configured providers: the Microsoft button appears only when Entra is configured, the local button only when the dev login is enabled.
- **Fail closed.** With no provider configured, env validation fails in every environment. In production it also fails when Entra is not configured or `AUTH_DEV_LOGIN` has any non-empty value, and a configured issuer that is not tenant-specific fails in every environment; `auth.ts` repeats these checks at runtime even when `SKIP_ENV_VALIDATION` is set, so every sign-in and session request fails (500) rather than opening access. The check is skipped only inside `next build`, where it cannot enable the dev login.
- The only production password login is the break-glass **master user** (see *Master user and break-glass* below; System Architecture — *Sign-in providers*, amended 2026-11-10). Email magic links are not adopted.
- From Phase 4R the dev-only login is rejected when Entra is configured.

---

## Role-based access (Phase 4R)

Decided 2026-11-10 — [Access Control spec](../specs/2026-11-10-access-control.md). Real tenant, group and object IDs are never committed; use placeholders.

### Entra portal steps (user action)

1. **App roles** on each app registration (dev and prod): `internal-admin`, `internal-org-admin`, `internal-auditor`, `internal-viewer` (allowed member type: users/groups). Keep the legacy `Admin` value until enforcement, then remove it.
2. **Groups claim:** Token configuration → add groups claim → **Groups assigned to the application**, emitted as object IDs in the ID token.
3. **Security groups** (placeholders): `llm-usage-lens-admins`, `-org-admins`, `-auditors`, `-users`, plus one group per team or department that should map automatically. Membership must be **direct** (nested groups are not honoured).
4. **Enterprise application:** assign the groups to their app roles (needs Entra ID **P1/P2**; without it assign users directly); set **"Assignment required?" = Yes**; assign the team groups (Default Access) so they appear in the `groups` claim.
5. **Conditional Access:** require MFA or a compliant device for both app registrations.
6. **Group mappings:** as `internal-admin`, map each team/department group object ID to its team or department and to `member` or `internal-team-admin` in Settings.

### Master user and break-glass

- Generate an Argon2id hash of a long random password and a TOTP secret; store both, with the username, as SSM SecureStrings under `/llm-usage-lens/<env>/auth/*`; the task definition injects them (Platform spec).
- **Custody:** seal the password and TOTP seed with two-person control; rotate after every use and at least yearly; test a sign-in quarterly and record it.
- Keep **at least two** named `internal-admin` holders in Entra besides the master user, and follow the tenant's own break-glass procedure for Entra outages.

### Rollout runbook

1. In `dev` (`APP_ENV=dev`), set `AUTH_ACCESS_MODE=open`, deploy, create the groups and app roles, and add the group mappings.
2. Sign in with one test user per role and scope case and run the acceptance checklist.
3. Set `AUTH_ACCESS_MODE=enforce` in `dev` and repeat the checklist. **Before the first `prod` deploy**, create the `internal-*` app roles on the prod app registration and assign the prod groups to them — with `APP_ENV=prod` the legacy `Admin` alias is not accepted, so prod admins would otherwise lose access. Then deploy `prod` (`APP_ENV=prod`, where `enforce` is the only accepted value).
4. Record the works-council / data-protection approval in Settings before enabling per-user views in `prod`.
5. Remove the legacy `Admin` app role.

### Acceptance checklist (one test user per case)

- [ ] No mapped group → *My usage* and "Ask your team lead for access"; no team data
- [ ] Member of one team → that team only, per visibility
- [ ] Two member-mapped groups → no team, flagged as ambiguous
- [ ] `internal-team-admin` on two teams → both teams, nothing else; can promote within them, not on themselves
- [ ] Department-scope `internal-team-admin` → the department's teams; can move members between them
- [ ] `internal-org-admin` → every team; no configuration; cannot grant global roles
- [ ] `internal-auditor` → everything read-only; every write `403`; audit view itself audited
- [ ] `internal-admin` → grant `internal-org-admin` (re-auth and reason required; audited; alarm fires)
- [ ] Master user → TOTP required; 5 failures lock out; session ends after 1 hour
- [ ] Removing a member takes effect on their next request

---

## Switching Providers Later

Auth.js is the provider abstraction. To switch identity providers, change `apps/dashboard/auth.ts` (swap `MicrosoftEntraID` for another provider) and its environment variables and provider checks in `apps/dashboard/env.ts`. Also map the new provider's role claim to `session.user.roles` in `auth.ts`. Steps 5–8 never change.
