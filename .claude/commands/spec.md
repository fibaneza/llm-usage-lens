---
description: Load and summarise a project spec or guide
argument-hint: <architecture|data-model|design-system|phases|auth|aws-infra|dashboard-deploy>
---

# /spec

Resolve `$ARGUMENTS` to a file and read it before answering anything else.

| Argument | File |
|---|---|
| `architecture` | `docs/specs/2026-05-15-system-architecture.md` |
| `data-model` | `docs/specs/2026-05-15-data-model.md` |
| `design-system` | `docs/specs/2026-05-15-design-system.md` |
| `phases` | `docs/specs/2026-05-15-implementation-phases.md` |
| `auth` | `docs/guides/auth-setup.md` |
| `aws-infra` | `docs/guides/aws-infrastructure.md` |
| `dashboard-deploy` | `docs/guides/dashboard-deployment.md` |

Steps:

1. Read the entire file with the Read tool.
2. Produce a concise summary: status, scope, the top-level section headings,
   and 3–5 of the most load-bearing decisions or constraints.
3. Cite section headings when answering follow-up questions from the user.

If `$ARGUMENTS` does not match any key above, list the available keys and
stop.
