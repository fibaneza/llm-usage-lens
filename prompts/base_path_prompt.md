# Base Path Prompt — serve the dashboard under a URL prefix (unit BP)

You are a **worker session**. You orchestrate agents through the Rule 70
loop; you write no production code or tests yourself. If a coordinator is
running (`prompts/coordinator_prompt.md`), you work under it.

Primary checkout: `/Users/fibanez/Projects/aws-bedrock-cost-tracker` (`$REPO`).
Work only in the worktree `.claude/worktrees/base-path` on branch
`feature/base-path`, created from an up-to-date `main` (Rule 31). Never edit
in the primary checkout or on `main`.

**Precedence:** `CLAUDE.md` → `.claude/rules/00–70` → `docs/specs/**` →
`prompts/shared-contracts.md` → `prompts/coordinator_prompt.md` → this file.
This file never overrides a rule. Where it disagrees with a spec, the spec
is amended first (§4, step 1) — never diverge silently (Rule 00.2).

## 1. What the user asked for (2026-11-17)

> "all path for the app should start with a prefix, i.e: llm-lens/ and so I
> could create a resource map on the ALB for the POC, to listen from 433 -
> currently in use by another app" … "create a rule"

Three requirements, each with its test in §5:

1. **Every URL of the app starts with one prefix** (`/llm-lens`): pages,
   Route Handlers, Auth.js routes, static assets, the health endpoint.
2. **The POC adds a listener rule to an existing ALB listener** (port 443,
   already serving another application) that forwards only the prefix to
   the POC's target group. It no longer needs its own listener port.
3. **The other application on that listener is not affected**: no path of
   ours outside the prefix, no cookie of ours sent to it.

## 2. What already exists — do not rebuild it

Paths below are relative to `apps/dashboard/` unless they start with `poc/`
or `infra/`. Verify each one; this map was taken on 2026-11-17 at `c989801`.

| Area | Today |
|---|---|
| Base path | None. `next.config.ts` sets no `basePath`; the app serves from `/`. |
| Client fetches | One chokepoint: `lib/query/fetch-api.ts` (`fetchApi`, `mutateApi`). About 60 `"/api/..."` literals in components and hooks pass through it. |
| Raw links | `components/settings/access/AccessReviewSection.tsx` has `<a href="/api/access-review" download>`. |
| Absolute URLs | `lib/api/password-user-route.ts` `setupLink()` builds `https://<host>/account/setup#<token>`. `lib/api/respond.ts` compares the request origin and host. |
| Auth | `auth.ts`: `pages.signIn: "/sign-in"`, `pages.error: "/no-access"`, `redirectTo: "/dashboard"` (4 sign-in functions), `isApiPath()` on `nextUrl.pathname`. `lib/auth/step-up.ts` builds `redirectTo`. `components/layout/AppHeader.tsx` signs out to `/sign-in`. `next-auth` is `5.0.0-beta.31`, Next is `^16.2.7`. |
| Proxy | `proxy.ts` matcher: `/dashboard/:path*` and `/api/…` except `auth` and `health`. |
| Redirects | `redirect("/sign-in")` and `redirect("/dashboard/manage/audit")` in a few pages and `lib/usage-access.ts`. |
| Navigation | `lib/nav.ts`, `lib/settings-tabs.ts` (`SETTINGS_BASE_PATH` is the Settings route, not a URL prefix), `usePathname()` in `SettingsTabs`, `SettingsHashResolver`, `PageTitle`. |
| Headers | `next.config.ts` applies the security headers to `source: "/:path*"`. |
| Image | `Dockerfile` builds once with `SKIP_ENV_VALIDATION=1`; `NEXT_PUBLIC_*` values are fixed at build time. |
| Health | `GET /api/health`: `infra/lib/dashboard-service/ingress.ts` (`HEALTH_PATH`), `poc/cloudformation.yml` (`HealthCheckPath`), `poc/docker-compose.yml` (healthcheck), `poc/README.md` (curl commands). |
| ECS platform | One **host-based** listener rule (Platform spec). It does not need a prefix. |
| POC load balancer | `poc/cloudformation.yml` adds its **own listener** (`AlbListenerPort`) and a target group to an existing ALB, plus a new security group that `poc/scripts/alb-security-group.sh` attaches. `poc/README.md` says: "the POC does not add rules to an existing listener". |
| Tests | About 116 Vitest files and 235 Playwright calls use unprefixed paths. |

## 3. Decisions

Agent decisions (Rule 00.3). Record each in the spec with its reason. Change
one only with a better reason, and say so in the report.

- **D1 — Prefix is build configuration, default empty.** A new variable
  `NEXT_PUBLIC_BASE_PATH` (validated in `env.ts`, read by `next.config.ts`)
  sets Next's `basePath`. Empty means "serve from `/`", which keeps dev, CI,
  the e2e harness and the ECS platform exactly as they are. The POC builds
  with `/llm-lens`. Reason: `basePath` is compiled into the client bundle,
  so it cannot be a runtime setting, and a forced prefix would rewrite every
  test and the Platform spec's host rule for no gain.
- **D2 — Format.** Empty, or `/` followed by lower-case letters, digits and
  hyphens, in one or more segments, with no trailing slash. The user's
  "llm-lens/" is `/llm-lens`. An invalid value fails the build.
- **D3 — Code keeps unprefixed paths.** `"/dashboard/..."` and `"/api/..."`
  literals stay as they are. Next adds the prefix for `Link`, `router`,
  `redirect()` and `_next` assets. For the places Next does not cover, add
  **one** client-safe helper (for example `lib/base-path.ts`,
  `withBasePath(path)`) and use it only in: `lib/query/fetch-api.ts`, the
  raw `<a href>` download link, `setupLink()`, and any other raw URL you
  find. No barrel file, no second helper.
- **D4 — The ALB does not strip the prefix.** The rule forwards the request
  unchanged; the app owns the prefix. Rule conditions are the two path
  patterns `<prefix>` and `<prefix>/*` — never `<prefix>*`, which would also
  match `/llm-lens-other`.
- **D5 — Health moves with the app.** With a prefix the endpoint is
  `<prefix>/api/health`; `/api/health` then answers `404`. Every health
  check follows the prefix.
- **D6 — The image is per prefix.** `poc/scripts/build-and-push.sh` passes
  the prefix as a Docker build argument (default `/llm-lens` for the POC,
  overridable, empty allowed). The tag stays `latest`.
- **D7 — Two POC load-balancer modes, never both.** *Listener mode* (today:
  own port) stays. *Rule mode* is new: parameters for the existing listener
  ARN, the rule priority and the path prefix; it creates an
  `AWS::ElasticLoadBalancingV2::ListenerRule` and the target group, and no
  listener and no certificate. The template refuses a mix of both modes.
- **D8 — Cookies stay inside the prefix.** With a prefix, the session and
  the other Auth.js cookies carry `Path=<prefix>` so the browser never sends
  them to the other application on the same host. Check the cookie names in
  the installed `next-auth`: a cookie with the `__Host-` name prefix is only
  accepted with `Path=/`, so it needs another name when the path is scoped.
  This decision gets the security pass in the review (§7).

**Do not answer from memory how Auth.js v5 behaves under a Next `basePath`**
(its own `basePath`, `AUTH_URL`, the callback URL, the redirects after
sign-in and sign-out, `pages.*`). Read the installed package's source and
current documentation, write down what you found in the run folder, and
let the tests in §5 prove it. The same holds for the proxy matcher,
`nextUrl.pathname`, `request.url` in Route Handlers and the `headers()`
source under a `basePath`.

### User answers and open inputs

- **Q1 — answered (user, 2026-11-17):** `/llm-lens` is the final prefix.
- **Q2 — answered (user, 2026-11-17):** the ECS platform (`infra/`) does
  not serve under the prefix. Its host-based rule stays; `infra/` only
  learns to derive the health path and the URLs from the prefix when one is
  configured.
- **Q3 — open, ask at the start, do not block on it:** the existing
  listener ARN and a free rule priority, and confirmation that the other
  application uses no path under `/llm-lens`. These are deploy inputs; they
  go in the gitignored `poc/stack.env` only.

## 4. The unit

One branch, one squash commit (Rule 30.4). Order:

1. **Specs first** (`spec-guardian` checks them in the review):
   - Platform spec — *Runtime*: the optional base path (D1, D2, D5), that
     the ECS rule stays host-based, and the build-time nature (D6).
   - Access Control spec — threat model: a shared host with another
     application (D8), and that no redirect or setup link can leave the
     prefix or the host.
   - `docs/guides/auth-setup.md`: with a prefix, `AUTH_URL` and the Entra
     redirect URI contain it. Registering the URI in Entra is a user action.
   - implementation-phases: record unit **BP** as user-directed
     (2026-11-17), outside the phase order, with its Verify checklist.
   - `docs/guides/testing.md` if a Playwright project is added.
2. **App** — `env.ts`, `next.config.ts`, the helper (D3), `auth.ts` and the
   cookie scope (D8), `Dockerfile` build argument, `.env.example`.
3. **`infra/`** — only what Q2's answer needs; the synth output with no
   prefix must not change.
4. **POC** — `poc/cloudformation.yml` (D7, health path parameter),
   `poc/scripts/deploy-stack.sh` and `poc/stack.env.example` (new options),
   `poc/scripts/build-and-push.sh` (D6), `poc/docker-compose.yml`
   (healthcheck), `poc/.env.example` (`AUTH_URL` and `NEXT_PUBLIC_APP_URL`
   with the prefix), `poc/README.md`: rewrite *Publish through an existing
   load balancer* for both modes, fix every health and URL command, and
   correct the two statements that are no longer true ("nothing outside this
   directory was changed", "does not add rules to an existing listener").
   Keep `alb-security-group.sh`: the load balancer still needs the POC
   group to reach the instance.

## 5. Tests (red first; every case cites its spec line or threat item)

Run every case with the prefix **empty and set**, unless it says otherwise.

| # | Behaviour | Layer |
|---|---|---|
| T1 | `NEXT_PUBLIC_BASE_PATH` accepts empty and valid values and rejects `llm-lens`, `/llm-lens/`, `/Llm`, `//x`, `/a b`, a full URL | unit (`env`, `next.config`) |
| T2 | `withBasePath` prefixes once, leaves absolute URLs alone, is a no-op when empty | unit |
| T3 | `fetchApi` and `mutateApi` request the prefixed URL | unit |
| T4 | `setupLink` contains the prefix and still uses the request `Host` | unit |
| T5 | No raw `fetch("/api…")` outside `lib/query/fetch-api.ts` and no raw `href="/…"` on an `<a>` in `app/` and `components/` | structure test (reads files) |
| T6 | Unauthenticated: an API route answers the `401` JSON shape, a page redirects to `<prefix>/sign-in` | integration |
| T7 | Sign-in lands on `<prefix>/dashboard`; sign-out on `<prefix>/sign-in`; the step-up redirect and the Auth.js callback URL stay inside the prefix; an outside `redirectTo` is refused | integration |
| T8 | With a prefix, every cookie the app sets has `Path=<prefix>`; without one, cookies are unchanged | integration |
| T9 | `<prefix>/api/health` is `200` with no session; with a prefix, `/api/health` and `/dashboard` are `404` | e2e (prefixed) |
| T10 | Security headers and `Cache-Control: private, no-store` are present on prefixed responses | e2e (prefixed) |
| T11 | Prefixed smoke: open `<prefix>`, sign in, the landing page loads its data, one sidebar link, one Settings tab, the access-review download link, sign out | e2e (prefixed) |
| T12 | `infra/` synth is unchanged with no prefix; with one, the health path and URLs carry it | infra |
| T13 | POC: rule mode creates a rule with both path patterns, the priority and no listener; both modes together are refused; the health check path follows the prefix; script options and `stack.env` keys load, placeholders are refused | the existing stub-AWS-CLI tests, `bash -n`, `docker compose config`, a template linter if one is installed |

The prefixed e2e (T9–T11) is **one small Playwright project** with its own
production server, port and `distDir`, built with the prefix. Run it once,
at the green gate. `next.config.ts`, `auth.ts` and `proxy.ts` are shared
files, so the unprefixed full e2e also runs once at the green gate
(Rule 70.12 — *E2E budget*). Do not convert the existing specs to prefixed
paths.

## 6. Out of scope

- Deploying, pushing an image, changing a load balancer, or registering an
  Entra redirect URI: user actions, listed in the report.
- A runtime-configurable prefix, path rewriting on the ALB, or a reverse
  proxy in front of the app.
- Changing the ECS platform's host-based rule (Q2).
- Renaming routes, or touching `tools/bedrock-simulator/`.

## 7. Ownership, guards and run discipline

- **Shared files — under a coordinator send `overlap bp: <path>` before
  editing:** `env.ts`, `.env.example`, `next.config.ts`, `auth.ts`,
  `proxy.ts`, `Dockerfile`, `playwright.config.ts`, `e2e/support/**`,
  `lib/query/fetch-api.ts`, `infra/lib/dashboard-service/**`.
- **One review** when the suite is green: `quality-reviewer` on opus with
  security scope for D8 and T7 (open redirect, cookie scope, host header),
  `spec-guardian` (specs changed), `playwright-ui-reviewer` (e2e changed).
- Role boundaries of Rule 70.8 hold. Name the model on every dispatch.
  Results, not logs. Check usage before each dispatch
  (`jq '.rate_limits' ~/.claude/usage-snapshot.json`): caution at 60% of
  the 5-hour window, no new agents at 75% — then log and stop.
- **Never** merge into `main`, never push, never bypass a hook, never
  deploy, never commit `temp/`, `poc/stack.env`, a real AWS account ID or a
  real ARN (placeholders use `000000000000`).
- Run folder `temp/run-base-path/` (findings on Auth.js and Next behaviour,
  progress, logs, report). Messages to the coordinator are one line:
  `progress`, `blocked`, `overlap`, `frozen`, `ready to merge bp at <commit>`.

## 8. Completion criteria

The run is complete when all of these hold, or when it ends on a usage
freeze with the report written:

1. Specs amended and consistent; D1–D8 recorded with their reasons; the Q1
   and Q2 answers recorded as user decisions; Q3 asked, and its answer or
   the placeholder recorded.
2. With `NEXT_PUBLIC_BASE_PATH=/llm-lens`, every URL the app serves or
   links to starts with `/llm-lens`, and nothing outside it answers — shown
   by T5–T11, not asserted in prose.
3. With the variable empty, behaviour is unchanged: the branch gate is
   green on the branch with `main` merged in, and the unprefixed full e2e
   passed once.
4. The POC template has rule mode (D7) and its validation in T13 passed;
   `poc/README.md` commands match the template, scripts and Compose file.
5. The review approved, including the security pass on D8.
6. `temp/report_261117_base-path.md` written: what changed, the Auth.js and
   Next findings, decisions and reasons, test counts, **what was not
   verified** (no AWS deploy, no real ALB, no Entra sign-in), and the user
   actions in order: answer Q3, build and push the image, deploy the
   stack in rule mode, attach the security group, set `AUTH_URL`, register
   the Entra redirect URI.
7. `ready to merge bp at <commit>` reported. The user approves the merge.

`/goal` line:

```
/goal prompts/base_path_prompt.md §8 completion criteria met, and the report written — or the run ended by a usage freeze, with the report written.
```
