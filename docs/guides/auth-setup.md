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

The three `AUTH_MICROSOFT_ENTRA_ID_*` variables are optional **as a group**: set all three or none. Production requires them (System Architecture spec — *Authentication & Access*).

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
- The local identity carries the `Admin` role, so the Settings account actions work locally.
- The sign-in page lists only the configured providers: the Microsoft button appears only when Entra is configured, the local button only when the dev login is enabled.
- **Fail closed.** With no provider configured, env validation fails in every environment. In production it also fails when Entra is not configured or `AUTH_DEV_LOGIN` has any non-empty value, and `auth.ts` repeats the check at runtime even when `SKIP_ENV_VALIDATION` is set, so every sign-in and session request fails (500) rather than opening access. The check is skipped only inside `next build`, where it cannot enable the dev login.
- A production password login is not available; it would need an amendment to the System Architecture spec first. Email magic links are not adopted.

---

## Switching Providers Later

Auth.js is the provider abstraction. To switch identity providers, change `apps/dashboard/auth.ts` (swap `MicrosoftEntraID` for another provider) and its environment variables and provider checks in `apps/dashboard/env.ts`. Also map the new provider's role claim to `session.user.roles` in `auth.ts`. Steps 5–8 never change.
