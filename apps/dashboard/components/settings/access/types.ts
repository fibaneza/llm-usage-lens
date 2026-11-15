import type { StepUpSection } from "@/lib/auth/step-up";

// Source: docs/specs/2026-11-10-access-control.md - "Permission matrix",
// "Recent authentication". Plain data the Settings page resolves on the server
// and hands to the client (Rule 10.3, 50.3).
export type AccessViewer = {
  roles: string[];
  authMethod: "entra" | "master" | "local" | "password";
  // Seconds since the epoch of the last interactive sign-in, when known.
  authTime?: number;
  adminScopes: { scopeType: "team" | "department"; scopeId: string }[];
};

// A refused credential step-up is the one generic `{ ok: false }`; success
// redirects (the server action never returns).
export type StepUpResult = { ok: false } | undefined;

export type StepUpActions = {
  entra: (section: StepUpSection) => Promise<StepUpResult>;
  credentials: (
    form: FormData,
    section: StepUpSection,
  ) => Promise<StepUpResult>;
};
