"use server";

import { auth, signIn } from "@/auth";
import {
  buildEntraStepUp,
  buildMasterStepUp,
  buildPasswordStepUp,
} from "@/lib/auth/step-up";
import type { StepUpSection } from "@/lib/auth/step-up";

// Source: docs/specs/2026-11-10-access-control.md - "Recent authentication",
// Step-up (T32): a step-up is a full sign-in through the existing providers,
// returning to the section that asked (D33). The identifier comes from the
// session, never from the client. A refused credential step-up is the one
// generic `{ ok: false }`; success redirects.
export async function stepUpWithEntra(
  section: StepUpSection,
): Promise<{ ok: false } | undefined> {
  const step = buildEntraStepUp(section);
  if (step === null) return { ok: false };
  const { providerId, redirectTo, authorizationParams } = step;
  await signIn(providerId, { redirectTo }, authorizationParams);
  return undefined;
}

export async function stepUpWithCredentials(
  form: FormData,
  section: StepUpSection,
): Promise<{ ok: false } | undefined> {
  const session = await auth();
  const { env } = await import("@/env");
  const step =
    buildPasswordStepUp(session, form, section) ??
    buildMasterStepUp(session, form, env.AUTH_MASTER_USERNAME, section);
  if (step === null) return { ok: false };
  try {
    await signIn(step.providerId, {
      ...step.credentials,
      redirectTo: step.redirectTo,
    });
  } catch (error) {
    // Loaded on the failure path only, so importing this module (the page
    // does) never pulls next-auth's runtime into a unit test.
    const { AuthError } = await import("next-auth");
    if (error instanceof AuthError) return { ok: false };
    throw error;
  }
  return undefined;
}
