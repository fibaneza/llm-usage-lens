---
description: Run the spec's "Verify" checklist for a phase
argument-hint: <phase number, e.g. 1, 3, 4.2>
---

# /verify-phase

Execute the **Verify** bullets defined in the spec for phase `$ARGUMENTS`.

Steps:

1. Read `docs/specs/2026-05-15-implementation-phases.md`
   and extract the "Verify" line(s) for the requested phase.
2. For each bullet, choose the cheapest reliable check:
   - "project runs with `pnpm dev`" → start the dev server, hit `/`, stop it
   - "Microsoft Entra ID sign-in works" → manual; tell the user what to click
   - "seed script populates data" → run create-table + seed against DynamoDB
     Local, then `scan --table-name bedrock-usage --select COUNT`
   - "Route Handlers return validated data" → `curl` a sample endpoint and
     show the Zod-validated response shape
   - "responsive at all breakpoints" → manual; list the URLs and breakpoints
     for the user
3. Report each bullet as **pass / fail / manual** with the evidence
   (command + brief output).
4. If anything fails, do **not** mark the phase complete — file the failures
   as the next TODOs.
