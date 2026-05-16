# Authentication Setup Guide

**Scope:** Setting up dashboard authentication (Auth.js + Microsoft Entra ID) and AWS credentials for local development.

---

## Two Separate Credential Concerns

Do not confuse these:

| Concern | What it is | How it is handled |
|---|---|---|
| **Dashboard login** | How users sign into the dashboard | Auth.js (NextAuth v5) + Microsoft Entra ID |
| **App → AWS credentials** | How the Next.js server authenticates to DynamoDB | AWS SDK default credential chain (see below) |

## AWS Credentials for Local Development

- **Against DynamoDB Local** (the default for development) — no AWS account is needed. DynamoDB Local accepts dummy credentials.
- **Against real AWS DynamoDB** — use AWS SSO. Run `aws sso login --profile <name>`, set `AWS_PROFILE=<name>`, and the AWS SDK picks up the temporary SSO credentials automatically via its default credential chain.

Do not use static `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Short-lived SSO credentials are the standard practice.

---

## Auth.js + Microsoft Entra ID — Step by Step

### 1. Register the app in Microsoft Entra ID

- Create a free Entra tenant if you do not have one (Azure portal → Microsoft Entra ID).
- App registrations → **New registration**. Name it; pick "Single tenant".
- Redirect URI → platform **Web** → `http://localhost:3000/api/auth/callback/microsoft-entra-id`
- Copy the **Application (client) ID** and **Directory (tenant) ID**.
- Certificates & secrets → **New client secret** → copy the secret **value** (shown once).

### 2. Install Auth.js

```
pnpm add next-auth@beta
```

### 3. Environment variables (`.env.local`)

```
AUTH_SECRET=                # generate with: npx auth secret
AUTH_URL=http://localhost:3000
AUTH_MICROSOFT_ENTRA_ID_ID=<application/client id>
AUTH_MICROSOFT_ENTRA_ID_SECRET=<client secret value>
AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/<tenant id>/v2.0
```

### 4. `auth.ts` (project root)

Auth.js v5 auto-reads the `AUTH_MICROSOFT_ENTRA_ID_*` variables.

```ts
import NextAuth from "next-auth"
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [MicrosoftEntraID],
  callbacks: {
    authorized: ({ auth }) => !!auth, // gates matched routes in middleware
  },
})
```

### 5. Auth route handler — `app/api/auth/[...nextauth]/route.ts`

```ts
import { handlers } from "@/auth"
export const { GET, POST } = handlers
```

### 6. `middleware.ts` (project root)

Protects the dashboard and API routes, excluding the auth routes themselves.

```ts
export { auth as middleware } from "@/auth"

export const config = {
  matcher: ["/dashboard/:path*", "/api/((?!auth).*)"],
}
```

### 7. Sign-in page — `app/sign-in/page.tsx`

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

Visit `/dashboard` → redirected to `/sign-in` → "Sign in with Microsoft" → Entra login → back to `/dashboard`.

---

## Switching Providers Later

Auth.js is the provider abstraction. To switch identity providers, change only `auth.ts` — swap `MicrosoftEntraID` for another provider and update its environment variables. Steps 5–8 never change.
