# Rule 30 — Phase discipline

Source: `docs/specs/2026-05-15-implementation-phases.md`.

## Build order (strict)

```
1 Foundation → 2 Layout Shell → 3 Data Layer
  → 4 Pages (4.1 → 4.9, in order)
    → 5 Polish & Accessibility
      → 6 AWS Lambda Collector
```

## Rules

1. **Do not start a phase whose dependencies are unmet.** Run `/phase-status`
   first; if blocked, surface it and stop.
2. **Components are built where first needed** and reused later. Do not
   speculatively build components for a future page.
3. **Each phase has a "Verify" checklist in the spec.** Complete it before
   moving on. Use `/verify-phase <n>`.
4. **Phase 4 sub-phases are independently deliverable** — one page at a time.
   Do not combine 4.x sub-phases in a single PR unless explicitly asked.
5. **Phase 6 (the Lambda collector) is last.** The dashboard is developed
   against DynamoDB Local + seed scripts until then.
6. **Repo state today:** pre-implementation. Only `docs/`, `LICENSE`,
   `.gitignore`, `.github/`, `.claude/`, and `CLAUDE.md` exist. There is no
   `package.json` yet. Phase 1 establishes the toolchain.
