"use client";

import { OrgUnitsSchema, type PasswordUserInput } from "@llm-usage-lens/shared";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";

import {
  accessErrorMessage,
  isReauthRequired,
} from "@/components/settings/access/access-error-message";
import { PasswordUserWithLinkSchema } from "@/components/settings/access/access-schemas";
import {
  FormError,
  FormField,
  FormStatus,
  NativeSelect,
} from "@/components/settings/access/form-controls";
import { StepUpDialog } from "@/components/settings/access/StepUpDialog";
import type {
  AccessViewer,
  StepUpActions,
} from "@/components/settings/access/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AddUserSteps } from "@/lib/auth/add-user-steps";
import { fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: Design System - Management improvements, Users (D15). Composes the
// existing writes as steps: POST /api/password-users (pre-SSO, internal-admin,
// recent authentication, setup link shown once), POST /api/teams/[id]/members
// (pending member by email). Each step renders only when `steps` allows it;
// the routes decide again (Rule 10.3). Step 3, the LiteLLM link, is the row
// action of the list: a person has no identity to link until they sign in.
const EmailSchema = z.email("Enter a valid email address");
const NOT_RECENT =
  "Your sign-in could not be confirmed as recent. Sign out and sign in again, then retry.";

type Result = {
  setupLink: string | null;
  teamAdded: boolean;
  error: string | null;
};

export function AddUserDialog({
  steps,
  authMethod,
  stepUp,
  initialEmail = "",
  onClose,
  onWritten,
}: {
  steps: AddUserSteps;
  authMethod: AccessViewer["authMethod"];
  stepUp: StepUpActions;
  // INV2: the Not signed in yet row fills in the person's email.
  initialEmail?: string;
  onClose: () => void;
  onWritten: () => void;
}) {
  const orgUnits = useQuery({
    queryKey: ["access", "org-units"],
    queryFn: () => fetchApi("/api/access/org-units", OrgUnitsSchema),
    enabled: steps.team,
  });
  const [email, setEmail] = useState(initialEmail);
  const [displayName, setDisplayName] = useState("");
  const [createPassword, setCreatePassword] = useState(steps.password);
  const [teamId, setTeamId] = useState("");
  const [errors, setErrors] = useState<
    Partial<Record<"email" | "displayName" | "team", string>>
  >({});
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [steppedUp, setSteppedUp] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const teamRequired = !(steps.password && createPassword);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: typeof errors = {};
    const parsed = EmailSchema.safeParse(email.trim());
    if (!parsed.success) found.email = "Enter a valid email address";
    if (steps.password && createPassword && displayName.trim() === "") {
      found.displayName = "Display name is required";
    }
    if (steps.team && teamRequired && teamId === "") {
      found.team = "Choose a team";
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || !parsed.success) return;

    setPending(true);
    let setupLink: string | null = null;
    try {
      if (steps.password && createPassword) {
        const body: PasswordUserInput = {
          email: parsed.data,
          displayName: displayName.trim(),
        };
        const created = await mutateApi(
          "/api/password-users",
          "POST",
          body,
          PasswordUserWithLinkSchema,
        );
        setupLink = created.setupLink;
        onWritten();
      }
      let teamAdded = false;
      if (steps.team && teamId !== "") {
        try {
          await mutateApi(
            `/api/teams/${encodeURIComponent(teamId)}/members`,
            "POST",
            { emailOrUpn: parsed.data },
            z.unknown(),
          );
          teamAdded = true;
          onWritten();
        } catch (error) {
          setResult({
            setupLink,
            teamAdded: false,
            error: `The team step failed: ${accessErrorMessage(error)}`,
          });
          return;
        }
      }
      setResult({ setupLink, teamAdded, error: null });
    } catch (error) {
      if (isReauthRequired(error)) {
        if (steppedUp) {
          setResult({ setupLink: null, teamAdded: false, error: NOT_RECENT });
        } else {
          setStepUpOpen(true);
        }
        return;
      }
      setResult({
        setupLink: null,
        teamAdded: false,
        error: accessErrorMessage(error),
      });
    } finally {
      setPending(false);
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  if (stepUpOpen) {
    return (
      <StepUpDialog
        authMethod={authMethod}
        stepUp={stepUp}
        section="password-users"
        onDone={() => {
          setStepUpOpen(false);
          setSteppedUp(true);
        }}
        onClose={() => setStepUpOpen(false)}
        onRedirect={onClose}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            {steps.password
              ? "Create a password sign-in and optionally add the person to a team."
              : "Add a person to a team by email. They join at their first sign-in."}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="flex flex-col gap-3">
            {result.setupLink ? (
              <>
                <FormField label="Setup link">
                  {(props) => (
                    <Input
                      {...props}
                      readOnly
                      value={result.setupLink ?? ""}
                      className="font-mono"
                    />
                  )}
                </FormField>
                <p className="text-muted-foreground text-sm">
                  Send this link to the user. It will not be shown again.
                </p>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copy(result.setupLink ?? "")}
                  >
                    <Copy aria-hidden />
                    Copy link
                  </Button>
                </div>
                {copyFailed ? (
                  <FormError>
                    Couldn&apos;t copy automatically. Select the link and copy
                    it.
                  </FormError>
                ) : null}
                {copied ? <FormStatus>Link copied.</FormStatus> : null}
              </>
            ) : null}
            {result.teamAdded ? (
              <FormStatus>
                Added as a pending member; the person joins at their first
                sign-in.
              </FormStatus>
            ) : null}
            {result.error ? <FormError>{result.error}</FormError> : null}
            {steps.link && !result.error ? (
              <p className="text-muted-foreground text-sm">
                Once the person appears in the list, use the LiteLLM link action
                on their row.
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(event) => void submit(event)}
            noValidate
            className="flex flex-col gap-4"
          >
            <FormField label="Work email" error={errors.email}>
              {(props) => (
                <Input
                  {...props}
                  type="text"
                  inputMode="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </FormField>
            {steps.password ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={createPassword}
                    onChange={(e) => setCreatePassword(e.target.checked)}
                  />
                  Create a password sign-in
                </label>
                {createPassword ? (
                  <FormField label="Display name" error={errors.displayName}>
                    {(props) => (
                      <Input
                        {...props}
                        autoComplete="off"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                      />
                    )}
                  </FormField>
                ) : null}
              </>
            ) : null}
            {steps.team ? (
              <FormField
                label={teamRequired ? "Team" : "Team (optional)"}
                error={errors.team}
              >
                {(props) => (
                  <NativeSelect
                    {...props}
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                  >
                    <option value="">
                      {orgUnits.isPending ? "Loading teams..." : "No team"}
                    </option>
                    {(orgUnits.data?.teams ?? []).map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                Add user
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
